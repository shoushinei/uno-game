// ========================================
// メインコントローラー（大富豪×UNO 融合版）
// 認証・ロビー・リアクション・退出は元のまま流用
// ゲームロジック部分のみ融合ゲーム用に差し替え
// ========================================
import { state, uid, newRoomId } from "./state.js";
import { fbGet, fbSet, fbUpdate, fbListen, testConnection } from "./db.js";
import { auth, googleProvider } from "./firebase-config.js";
import { signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  show, setHomeMsg, setLobbyMsg, setStatus, dbg, setLoading,
  renderLobby, renderGame, renderResult, flashReactionBtn,
} from "./ui.js";
import {
  initFusionGame,
  applyTrumpPlay, applyTrumpPass,
  applyUnoPlay, applyUnoDraw,
} from "./game-logic.js";

// ========================================
// Google ログイン（元のまま流用）
// ========================================
const loginButton = document.getElementById("login-btn");
if (loginButton) {
  loginButton.addEventListener("click", async () => {
    try {
      setStatus("Google ログイン画面を起動中...");
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setHomeMsg("ログイン失敗: " + e.message);
      setStatus("ログインエラー", "err");
      dbg("Googleログイン失敗: " + e.message, true);
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  const loginArea    = document.getElementById("login-area");
  const gameMenuArea = document.getElementById("game-menu-area");
  const niInput      = document.getElementById("ni");
  if (user) {
    dbg("Google ログイン成功: " + user.displayName);
    if (loginArea)    loginArea.style.display    = "none";
    if (gameMenuArea) gameMenuArea.style.display = "block";
    if (niInput)      niInput.value = user.displayName ? user.displayName.slice(0, 12) : "ゲスト";
    setStatus("Firebase 接続テスト中...");
    const ok = await testConnection();
    if (ok) {
      setStatus(`ログイン中: ${user.displayName} ✓`, "ok");
      dbg("Firebase 接続成功");
    } else {
      setStatus("接続エラー — データベースへのアクセス権限がありません", "err");
      dbg("Firebase 接続失敗", true);
    }
  } else {
    if (loginArea)    loginArea.style.display    = "block";
    if (gameMenuArea) gameMenuArea.style.display = "none";
    setStatus("Googleアカウントでログインしてください");
    dbg("未ログイン状態");
  }
});

// ========================================
// リアルタイムリスナー（元のまま流用）
// ========================================
function startListening() {
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = fbListen(
    "rooms/" + state.roomId,
    (room) => {
      if (!room) return;
      if (room.state === "lobby") {
        renderLobby(room);
      } else if (room.state === "playing") {
        if (!document.getElementById("s-game").classList.contains("active")) show("game");
        renderGame(room);
      } else if (room.state === "ended") {
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

// ========================================
// ルーム作成（最大8人に変更のみ）
// ========================================
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
      state: "lobby", host: state.myId,
      players: [{ id: state.myId, name: state.myName, bi: 0, ready: true }],
      game: null, log: [], ts: Date.now(), reactions: {}, trumpPassCount: 0,
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

// ========================================
// ルーム参加（最大8人に変更のみ）
// ========================================
window.joinRoom = async function () {
  const nm  = document.getElementById("ni").value.trim();
  const rid = document.getElementById("ri").value.trim().toUpperCase();
  if (!nm)              { setHomeMsg("名前を入力してください"); return; }
  if (rid.length !== 4) { setHomeMsg("4文字のルームIDを入力してください"); return; }
  setHomeMsg("");
  setLoading("join-btn", true, "参加中");
  try {
    const room = await fbGet("rooms/" + rid);
    if (!room)                  { setHomeMsg("ルームが見つかりません"); return; }
    if (room.state !== "lobby") { setHomeMsg("ゲームはすでに始まっています"); return; }
    const players = room.players || [];
    if (players.length >= 8)               { setHomeMsg("このルームは満員です（最大8人）"); return; }
    if (players.find(p => p.name === nm))  { setHomeMsg("この名前はすでに使われています"); return; }
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

// ========================================
// 準備完了トグル（元のまま流用）
// ========================================
window.toggleReady = async function () {
  try {
    const room    = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const players = room.players || [];
    const me      = players.find(p => p.id === state.myId);
    if (me) {
      me.ready = !me.ready;
      await fbUpdate("rooms/" + state.roomId, { players });
    }
  } catch (e) { dbg("toggleReady error: " + e.message, true); }
};

// ========================================
// ゲーム開始（最小3人に変更のみ）
// ========================================
window.startGame = async function () {
  try {
    const room    = await fbGet("rooms/" + state.roomId);
    if (!room || state.myId !== room.host) return;
    const players = room.players || [];
    if (players.length < 3) { setLobbyMsg("3人以上必要です"); return; }
    const game = initFusionGame(players);
    await fbUpdate("rooms/" + state.roomId, {
      state: "playing",
      game,
      log: ["🎮 大富豪×UNO 融合ゲーム開始！"],
      trumpPassCount: 0,
    });
  } catch (e) { dbg("startGame error: " + e.message, true); }
};

// ========================================
// トランプを出す
// ========================================
window.selectTrumpCard = async function (cardId) {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "trump") return;
    const pname  = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const result = applyTrumpPlay(g, state.myId, cardId, pname);
    if (!result) { dbg("出せないカードです", true); return; }
    const { g: newG, logMsg } = result;
    const logs = [...(room.log || []), logMsg];
    await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: 0 });
  } catch (e) { dbg("selectTrumpCard error: " + e.message, true); }
};

// ========================================
// トランプをパス
// ========================================
window.trumpPass = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "trump") return;
    const pname     = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const passCount = (room.trumpPassCount || 0) + 1;
    const { g: newG, logMsg } = applyTrumpPass(g, state.myId, pname);
    const logs = [...(room.log || []), logMsg];

    // 全員パス → 場を流す（最後にカードを出した人が親）
    if (g.trumpField && passCount >= g.order.length - 1) {
      // 自分の前のプレイヤー（最後にトランプを出した人）が親
      const myIdx    = g.order.indexOf(state.myId);
      const parentIdx = (myIdx - g.dir + g.order.length) % g.order.length;
      newG.trumpField = null;
      newG.hasParent  = g.order[parentIdx];
      const parentName = room.players.find(p => p.id === newG.hasParent)?.name || "?";
      logs.push(`全員パス！場が流れた 👑 ${parentName}が親になった`);
      await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: 0 });
    } else {
      await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: passCount });
    }
  } catch (e) { dbg("trumpPass error: " + e.message, true); }
};

// ========================================
// トランプ出し切り済み → UNOフェイズへスキップ
// ========================================
window.trumpSkip = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "trump") return;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    g.phase = "uno";
    const logs = [...(room.log || []), `${pname}のトランプは0枚（自動スキップ）→ UNOフェイズへ`];
    await fbUpdate("rooms/" + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg("trumpSkip error: " + e.message, true); }
};

// ========================================
// UNOカード選択（ワイルド系は色選択へ）
// ========================================
let pendingUnoIdx = null;

window.selectUnoCard = async function (idx) {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "uno") return;
    const myHand = (g.unoHands && g.unoHands[state.myId]) || [];
    const card   = myHand[idx]; if (!card) return;
    if (card.t === "w" || card.t === "w4") {
      pendingUnoIdx = idx;
      document.getElementById("cpick")?.classList.add("show");
      return;
    }
    await doUnoPlay(idx, null);
  } catch (e) { dbg("selectUnoCard error: " + e.message, true); }
};

// ========================================
// UNO色選択確定
// ========================================
window.pickColor = function (color) {
  document.getElementById("cpick")?.classList.remove("show");
  if (pendingUnoIdx === null) return;
  doUnoPlay(pendingUnoIdx, color);
  pendingUnoIdx = null;
};

async function doUnoPlay(idx, chosenColor) {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId) return;
    const pname  = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const result = applyUnoPlay(g, state.myId, idx, chosenColor, pname);
    if (!result) return;
    const { g: newG, logMsg, isGameOver } = result;
    // 最後の1人の名前を補完
    if (isGameOver) {
      newG.rankings.forEach(r => {
        if (r.name === "?") {
          const p = room.players.find(p2 => p2.id === r.id);
          if (p) r.name = p.name;
        }
      });
    }
    const logs = [...(room.log || []), logMsg];
    await fbUpdate("rooms/" + state.roomId, {
      game: newG,
      log:  logs.slice(-8),
      trumpPassCount: 0,
      ...(isGameOver ? { state: "ended" } : {}),
    });
  } catch (e) { dbg("doUnoPlay error: " + e.message, true); }
}

// ========================================
// UNOカードを引く
// ========================================
window.unoDraw = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "uno") return;
    const pname       = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const { g: newG, logMsg } = applyUnoDraw(g, state.myId, pname);
    const logs = [...(room.log || []), logMsg];
    await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8) });
  } catch (e) { dbg("unoDraw error: " + e.message, true); }
};

// ========================================
// UNO宣言
// ========================================
window.sayUno = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game; if (!g) return;
    if (!g.unoSaid) g.unoSaid = {};
    g.unoSaid[state.myId] = true;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const logs  = [...(room.log || []), `${pname}が「UNO！」と叫んだ 🎉`];
    await fbUpdate("rooms/" + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg("sayUno error: " + e.message, true); }
};

// ========================================
// 親の権限：UNOの色を変更
// ========================================
window.showParentColorPick = function () {
  document.getElementById("parent-cpick")?.classList.add("show");
};
window.pickParentColor = async function (color) {
  document.getElementById("parent-cpick")?.classList.remove("show");
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.hasParent !== state.myId) return;
    g.unoCurrentColor = color;
    g.hasParent = null; // 権限使用済み
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const cname = { red:"赤", blue:"青", green:"緑", yellow:"黄" }[color] || color;
    const logs  = [...(room.log || []), `${pname}が親の権限でUNOの色を【${cname}】に変更！`];
    await fbUpdate("rooms/" + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg("pickParentColor error: " + e.message, true); }
};

// ========================================
// リアクション送信（元のまま流用）
// ========================================
window.sendReaction = async function (emoji) {
  if (state.reactionCooldown) return;
  state.reactionCooldown = true;
  state.lastSentReaction = emoji;
  flashReactionBtn(emoji);
  try {
    await fbSet(`rooms/${state.roomId}/reactions/${state.myId}`, { emoji, ts: Date.now() });
  } catch (e) { dbg("sendReaction error: " + e.message, true); }
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};

// ========================================
// ロビーへ戻る（元のまま流用）
// ========================================
window.backToLobby = async function () {
  try {
    const room    = await fbGet("rooms/" + state.roomId);
    if (!room) return;
    const players = (room.players || []).map(p => ({ ...p, ready: p.id === room.host }));
    await fbUpdate("rooms/" + state.roomId, {
      state: "lobby", game: null, log: [], players, reactions: {}, trumpPassCount: 0,
    });
    show("lobby");
    startListening();
  } catch (e) { dbg("backToLobby error: " + e.message, true); }
};

// ========================================
// 退出（元のまま流用・無人なら部屋削除）
// ========================================
window.leaveGame = async function () {
  const rid  = state.roomId;
  const myId = state.myId;
  stopListening();
  if (rid && myId) {
    try {
      const room = await fbGet("rooms/" + rid);
      if (room && room.players) {
        const remainingPlayers = room.players.filter(p => p.id !== myId);
        if (remainingPlayers.length === 0) {
          await fbSet("rooms/" + rid, null);
          dbg("無人になったためルームを削除しました: " + rid);
        } else {
          const updates = { players: remainingPlayers };
          if (room.host === myId) {
            updates.host = remainingPlayers[0].id;
            const logs = [...(room.log || []), `${remainingPlayers[0].name} が新しいホストになりました`];
            updates.log = logs.slice(-8);
          }
          await fbUpdate("rooms/" + rid, updates);
          dbg("ルームから退出しました: " + rid);
        }
      }
    } catch (e) { dbg("退出処理でエラーが発生しました: " + e.message, true); }
  }
  state.roomId = "";
  state.myId   = "";
  state.myName = "";
  state.isHost = false;
  show("home");
};

// ========================================
// input オートフォーマット（元のまま流用）
// ========================================
document.getElementById("ri").addEventListener("input", function () {
  this.value = this.value.toUpperCase();
});
