// ========================================
// メインコントローラー（イベントハンドラ・ゲーム操作）
// ========================================
import { state, uid, newRoomId } from "./state.js";
import { fbGet, fbSet, fbUpdate, fbListen, testConnection } from "./db.js";
import { initGame, applyPlayCard, reshuffleInline, canPlay } from "./game-logic.js";
import {
  show, setHomeMsg, setLobbyMsg, setStatus, dbg, setLoading,
  renderLobby, renderGame, renderResult, flashReactionBtn,
} from "./ui.js";

// ----------------------------------------
// Firebase 接続テスト & 初期化
// ----------------------------------------
async function init() {
  setStatus("Firebase 接続テスト中...");
  dbg("初期化開始");
  const ok = await testConnection();
  if (ok) {
    setStatus("Firebase 接続完了 ✓", "ok");
    dbg("接続成功");
  } else {
    setStatus("接続エラー — Firebase のルールを確認してください", "err");
    dbg("接続失敗", true);
  }
}

// ----------------------------------------
// リアルタイムリスナー
// ----------------------------------------
function startListening() {
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = fbListen(
    "rooms/" + state.roomId,
    (room) => {
      if (!room) return;
      if (room.state === "lobby")   renderLobby(room);
      else if (room.state === "playing") {
        if (!document.getElementById("s-game").classList.contains("active")) show("game");
        renderGame(room);
      }
      else if (room.state === "ended") {
        if (!document.getElementById("s-result").classList.contains("active")) {
          state.unsubscribeRoom && state.unsubscribeRoom();
          show("result");
        }
        renderResult(room);
      }
    },
    (err) => dbg("同期エラー: " + err.message, true)
  );
}

function stopListening() {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }
}

// ----------------------------------------
// ルーム作成
// ----------------------------------------
window.createRoom = async function () {
  const nm = document.getElementById("ni").value.trim();
  if (!nm) { setHomeMsg("名前を入力してください"); return; }
  setHomeMsg("");
  setLoading("create-btn", true, "作成中");
  try {
    const ok = await testConnection();
    if (!ok) { setHomeMsg("Firebase 接続に失敗しました"); return; }

    state.myName = nm;
    state.myId   = uid();
    state.isHost = true;
    state.roomId = newRoomId();

    const room = {
      state:     "lobby",
      host:      state.myId,
      players:   [{ id: state.myId, name: state.myName, bi: 0, ready: true }],
      game:      null,
      log:       [],
      ts:        Date.now(),
      reactions: {},
    };
    await fbSet("rooms/" + state.roomId, room);
    document.getElementById("lrid").textContent = state.roomId;
    show("lobby");
    startListening();
    dbg("ルーム作成: " + state.roomId);
  } catch (e) {
    setHomeMsg("エラー: " + e.message);
    dbg("createRoom error: " + e.message, true);
  } finally {
    setLoading("create-btn", false, "新しいルームを作る");
  }
};

// ----------------------------------------
// ルーム参加
// ----------------------------------------
window.joinRoom = async function () {
  const nm  = document.getElementById("ni").value.trim();
  const rid = document.getElementById("ri").value.trim().toUpperCase();
  if (!nm)           { setHomeMsg("名前を入力してください"); return; }
  if (rid.length !== 4) { setHomeMsg("4文字のルームIDを入力してください"); return; }
  setHomeMsg("");
  setLoading("join-btn", true, "参加中");
  try {
    const room = await fbGet("rooms/" + rid);
    if (!room)                    { setHomeMsg("ルームが見つかりません"); return; }
    if (room.state !== "lobby")   { setHomeMsg("ゲームはすでに始まっています"); return; }
    const players = room.players || [];
    if (players.length >= 5)              { setHomeMsg("このルームは満員です（最大5人）"); return; }
    if (players.find((p) => p.name === nm)) { setHomeMsg("この名前はすでに使われています"); return; }

    state.myName = nm;
    state.myId   = uid();
    state.isHost = false;
    state.roomId = rid;

    players.push({ id: state.myId, name: state.myName, bi: players.length, ready: false });
    await fbUpdate("rooms/" + rid, { players });
    document.getElementById("lrid").textContent = state.roomId;
    show("lobby");
    startListening();
    dbg("参加完了: " + rid);
  } catch (e) {
    setHomeMsg("エラー: " + e.message);
    dbg("joinRoom error: " + e.message, true);
  } finally {
    setLoading("join-btn", false, "ルームに参加する");
  }
};

// ----------------------------------------
// 準備完了トグル
// ----------------------------------------
window.toggleReady = async function () {
  try {
    const room    = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const players = room.players || [];
    const me      = players.find((p) => p.id === state.myId);
    if (me) {
      me.ready = !me.ready;
      await fbUpdate("rooms/" + state.roomId, { players });
    }
  } catch (e) { dbg("toggleReady error: " + e.message, true); }
};

// ----------------------------------------
// ゲーム開始
// ----------------------------------------
window.startGame = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId);
    if (!room || state.myId !== room.host) return;
    const players = room.players || [];
    if (players.length < 2) return;
    const game = initGame(players);
    await fbUpdate("rooms/" + state.roomId, { state: "playing", game, log: ["ゲーム開始！"] });
  } catch (e) { dbg("startGame error: " + e.message, true); }
};

// ----------------------------------------
// カード選択（色なし）
// ----------------------------------------
window._selectCard = async function (idx) {
  try {
    const room = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const g = room.game;
    if (!g || g.order[g.ci] !== state.myId) return;
    const myHand = (g.hands && g.hands[state.myId]) || [];
    const card   = myHand[idx];
    if (!card) return;
    const top = g.discard[g.discard.length - 1];
    if (!canPlay(card, top, g.cc, g.penaltyCards, g.pendingSkip)) return;

    if (card.t === "w" || card.t === "w4") {
      state.pendingCardIdx = idx;
      document.getElementById("cpick").classList.add("show");
      return;
    }
    await doPlayCard(idx, null);
  } catch (e) { dbg("selectCard error: " + e.message, true); }
};

// ----------------------------------------
// 色選択
// ----------------------------------------
window.pickColor = function (color) {
  document.getElementById("cpick").classList.remove("show");
  if (state.pendingCardIdx === null) return;
  doPlayCard(state.pendingCardIdx, color);
  state.pendingCardIdx = null;
};

// ----------------------------------------
// カードを出す
// ----------------------------------------
async function doPlayCard(idx, chosenColor) {
  try {
    const room = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    let g = room.game;
    if (!g || g.order[g.ci] !== state.myId) return;

    const playerName = room.players.find((p) => p.id === state.myId)?.name || state.myName;
    const { g: newG, logMsg, isFinished } = applyPlayCard(g, state.myId, idx, chosenColor, playerName);

    const logs    = [...(room.log || []), logMsg];
    const updates = { game: newG, log: logs.slice(-8) };

    if (isFinished) {
      // 最後の一人を rankings に追加
      if (newG.order.length === 1) {
        const lastId   = newG.order[0];
        const lastName = room.players.find((p) => p.id === lastId)?.name || "?";
        if (!newG.rankings.some((r) => r.id === lastId)) {
          newG.rankings.push({ id: lastId, name: lastName });
        }
      }
      Object.assign(updates, { state: "ended" });
    }
    await fbUpdate("rooms/" + state.roomId, updates);
  } catch (e) { dbg("playCard error: " + e.message, true); }
}

// ----------------------------------------
// カードを引く
// ----------------------------------------
window.drawCard = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const g = room.game;
    if (!g || g.order[g.ci] !== state.myId) return;

    const deck  = [...g.deck];
    const pname = room.players.find((p) => p.id === state.myId)?.name || state.myName;
    let extraLog = "";

    if (g.penaltyCards > 0) {
      const th    = [...(g.hands[state.myId] || [])];
      const count = g.penaltyCards;
      for (let i = 0; i < count; i++) {
        if (!deck.length) reshuffleInline(g);
        if (deck.length) th.push(deck.pop());
      }
      g.hands[state.myId] = th;
      g.penaltyCards = 0;
      extraLog = `がペナルティカードを ${count} 枚引いた`;
    } else if (g.pendingSkip) {
      g.pendingSkip = false;
      extraLog = "がスキップを受け入れた";
    } else {
      if (!deck.length) reshuffleInline(g);
      if (deck.length) {
        g.hands[state.myId] = [...(g.hands[state.myId] || []), deck.pop()];
      }
      extraLog = "がカードを引いた";
    }

    g.deck = deck;
    const n = g.order.length;
    g.ci = (g.ci + g.dir + n) % n;
    const logs = [...(room.log || []), `${pname}${extraLog}`];
    await fbUpdate("rooms/" + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg("drawCard error: " + e.message, true); }
};

// ----------------------------------------
// UNO 宣言
// ----------------------------------------
window.sayUno = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const g = room.game;
    if (!g) return;
    if (!g.unoSaid) g.unoSaid = {};
    g.unoSaid[state.myId] = true;
    const pname = room.players.find((p) => p.id === state.myId)?.name || state.myName;
    const logs = [...(room.log || []), `${pname}が「UNO！」と叫んだ 🎉`];
    await fbUpdate("rooms/" + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg("sayUno error: " + e.message, true); }
};

// ----------------------------------------
// リアクション送信（クールダウン付き）
// ----------------------------------------
window.sendReaction = async function (emoji) {
  if (state.reactionCooldown) return;
  state.reactionCooldown  = true;
  state.lastSentReaction  = emoji;

  // ボタンのビジュアルフィードバック
  flashReactionBtn(emoji);

  try {
    await fbSet(`rooms/${state.roomId}/reactions/${state.myId}`, { emoji, ts: Date.now() });
  } catch (e) { dbg("sendReaction error: " + e.message, true); }

  // 2秒間クールダウン
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};

// ----------------------------------------
// ロビーへ戻る
// ----------------------------------------
window.backToLobby = async function () {
  try {
    const room    = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const players = (room.players || []).map((p) => ({
      ...p,
      ready: p.id === room.host,
    }));
    await fbUpdate("rooms/" + state.roomId, {
      state: "lobby", game: null, log: [], players, reactions: {},
    });
    show("lobby");
    startListening();
  } catch (e) { dbg("backToLobby error: " + e.message, true); }
};

// ----------------------------------------
// ゲーム退出
// ----------------------------------------
window.leaveGame = function () {
  stopListening();
  state.roomId = "";
  state.myId   = "";
  state.myName = "";
  state.isHost = false;
  show("home");
};

// ----------------------------------------
// input オートフォーマット
// ----------------------------------------
document.getElementById("ri").addEventListener("input", function () {
  this.value = this.value.toUpperCase();
});

// ----------------------------------------
// 起動
// ----------------------------------------
init();
