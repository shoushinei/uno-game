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
  trumpCanPlay,
  trumpStrength,
} from "./game-logic.js";

// ui.js の trumpCanPlayCard から参照するためwindowに公開
window._trumpLogic = { trumpCanPlay };
window._currentTrumpHand = [];

//  選択されたカードの情報を一時保存する変数を追加
let selectedTrumpIds = [];
let selectedUnoIdx = null;

// ui.jsから参照できるようwindowに公開
Object.defineProperty(window, '_selectedTrumpIds', { get: () => selectedTrumpIds });
Object.defineProperty(window, '_selectedUnoIdx',   { get: () => selectedUnoIdx });

/**
 * トランプカードが現在出せるか判定する関数（ui.jsから呼ばれる）
 * 複数枚選択中は「同ランクのカード」のみ追加選択可能
 */
window.trumpCanPlayCard = function(card, fieldCards, currentSelectedIds) {
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];
  
  // すでに選択済みのカードなら、選択解除操作のために常に true を返す
  if (currentSelectedIds.length > 0 && currentSelectedIds.includes(card.id)) return true;

  const hand = window._currentTrumpHand || [];

  // 【1枚目の選択判定】
  if (currentSelectedIds.length === 0) {
    if (fCards.length === 0) return true; // 場が空なら手札の何でも1枚目として選択可能！

    // 場にカードがある場合、その場にあるカード（の1枚目）の数字より強いカードしか選べない
    const fNonJoker = fCards.filter(c => c.v !== 'JOKER');
    const fValue = fNonJoker.length > 0 ? fNonJoker[0].v : 'JOKER';
    
    return trumpStrength(card) > trumpStrength({ v: fValue });
  }

  // 【2枚目以降の選択判定】
  const firstCard = hand.find(c => c.id === currentSelectedIds[0]);
  if (!firstCard) return false;

  // 最初に選んだカードと同じ数字（またはJOKER）のみ追加選択可能
  if (card.v !== firstCard.v && card.v !== 'JOKER' && firstCard.v !== 'JOKER') return false;

  // もし場にカードがあるなら、場の枚数を超えて選択することはできない
  if (fCards.length > 0 && currentSelectedIds.length >= fCards.length) return false;

  return true;
};

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
      // ui.js の複数枚選択判定用に現在の手札を更新
      if (room.game && room.game.trumpHands) {
        window._currentTrumpHand = room.game.trumpHands[state.myId] || [];
      }
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

/**
 * トランプ手札の選択状態だけをDOMに反映する軽量再描画
 * Firebase を経由せずローカルで即座に更新する
 */
function _refreshTrumpHandDisplay() {
  const el = document.getElementById("my-trump-hand"); if (!el) return;
  el.querySelectorAll(".trump-hand-card").forEach(div => {
    const cardId = div.dataset.cardId;
    if (!cardId) return;
    const isSelected = selectedTrumpIds.includes(cardId);
    div.classList.toggle("selected", isSelected);
    
    // 選択中カードがある場合、同ランク以外の未選択カードを暗転＆クリック不可にする
    if (selectedTrumpIds.length > 0 && !isSelected) {
      const firstV = window._currentTrumpHand?.find(c => c.id === selectedTrumpIds[0])?.v;
      const thisV  = window._currentTrumpHand?.find(c => c.id === cardId)?.v;
      if (firstV !== undefined && firstV !== thisV) {
        div.classList.add("off");
        div.onclick = null; // 同ランク以外はクリックイベントを消す
      }
    } else {
      // 選択が0枚に戻った時、または同ランクのカードのイベントを「再代入」して復活させる！
      if (div.dataset.canPlay === "1" || isSelected) {
        div.classList.remove("off");
        div.onclick = () => window.selectTrumpCard(cardId); // ⚡️これでフリーズが直ります！
      }
    }
  });
}

/**
 * UNO手札の選択状態だけをDOMに反映する軽量再描画
 */
function _refreshUnoHandDisplay() {
  const el = document.getElementById("my-uno-hand"); if (!el) return;
  el.querySelectorAll(".hcd").forEach(div => {
    const idxStr = div.dataset.cardIdx;
    if (idxStr === undefined) return;
    const idx = parseInt(idxStr, 10);
    div.classList.toggle("selected", idx === selectedUnoIdx);
  });
}

window.selectTrumpCard = function (cardId) {
  const hand = window._currentTrumpHand;

  if (selectedTrumpIds.includes(cardId)) {
    // 選択解除
    selectedTrumpIds = selectedTrumpIds.filter(id => id !== cardId);
  } else {
    // 新規選択：複数枚は同ランクのみ許可
    if (selectedTrumpIds.length === 0) {
      selectedTrumpIds.push(cardId);
    } else {
      const firstV = hand.find(c => c.id === selectedTrumpIds[0])?.v;
      const thisV  = hand.find(c => c.id === cardId)?.v;
      if (firstV !== undefined && firstV === thisV) {
        selectedTrumpIds.push(cardId);
      }
      // 異なるランクは無視（選択できない）
    }
  }

  // ボタンの表示とラベル更新
  const playBtn = document.getElementById("trump-play-btn");
  if (playBtn) {
    if (selectedTrumpIds.length > 0) {
      playBtn.style.display = "inline-block";
      playBtn.textContent = selectedTrumpIds.length === 1
        ? "選択したトランプを出す"
        : `選択した ${selectedTrumpIds.length} 枚を出す`;
    } else {
      playBtn.style.display = "none";
    }
  }

  // 手札を再描画して選択状態を反映（renderGameを呼ばずに手札のみ更新）
  _refreshTrumpHandDisplay();
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

    // ⚡️ここではパスカウントを増やすだけ。場を流す処理は次のUNOフェイズ終了時に安全に行います。
    await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: passCount });
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

window.selectUnoCard = function (idx) {
  // 同じカードをタップしたら解除、別のカードなら上書き選択
  selectedUnoIdx = (selectedUnoIdx === idx) ? null : idx;

  // カードが選択されていたら「決定ボタン」を表示、選択解除されたら非表示にする
  const playBtn = document.getElementById("uno-play-btn");
  if (playBtn) {
    playBtn.style.display = selectedUnoIdx !== null ? "inline-block" : "none";
  }

  // 手札を再描画して選択状態を反映
  _refreshUnoHandDisplay();
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
    
    // 現在のトランプパスカウントを一時記憶
    const currentPassCount = room.trumpPassCount || 0;

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

    // ⚡️UNOを出し終え、スキップ等も計算された「本当の次のプレイヤー」が決まった手番で場を流す判定を行う
    const fCards = Array.isArray(newG.trumpField) ? newG.trumpField : [];
    if (fCards.length > 0 && currentPassCount >= newG.order.length - 1 && newG.order.length > 0) {
      const nextPlayerId = newG.order[newG.ci];
      newG.trumpField = [];           // トランプの場を完全にクリア
      newG.hasParent  = nextPlayerId; // スキップ等も考慮された次の人に親権限を付与
      
      const parentName = room.players.find(p => p.id === nextPlayerId)?.name || "?";
      logs.push(`全員パス！場が流れた 👑 ${parentName}が親になった`);

      await fbUpdate("rooms/" + state.roomId, {
        game: newG,
        log:  logs.slice(-8),
        trumpPassCount: 0, // 親が決まったのでパスカウントをリセット
        ...(isGameOver ? { state: "ended" } : {}),
      });
    } else {
      await fbUpdate("rooms/" + state.roomId, {
        game: newG,
        log:  logs.slice(-8),
        ...(isGameOver ? { state: "ended" } : {}),
      });
    }
  } catch (e) { dbg("doUnoPlay error: " + e.message, true); }
}
// ========================================
// 決定ボタンが押された時の確定送信処理
// ========================================
window.submitTrumpPlay = async function () {
  if (selectedTrumpIds.length === 0) return;
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    let g = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "trump") return;

    // 場にカードがある場合、選択枚数と場の枚数が一致していなければ出せない
    const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
    if (fCards.length > 0 && selectedTrumpIds.length !== fCards.length) {
      dbg(`場の枚数（${fCards.length}枚）と一致させてください`, true);
      return;
    }

    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    
    // 選択されたカードIDの配列を「一括」でロジックへ渡す
    const result = applyTrumpPlay(g, state.myId, selectedTrumpIds, pname);
    if (!result) { dbg("選択したカードの組み合わせは出せません", true); return; }

    const logs = [...(room.log || []), result.logMsg];
    await fbUpdate("rooms/" + state.roomId, { game: result.g, log: logs.slice(-8), trumpPassCount: 0 });

    // 送信成功後に選択をリセット
    selectedTrumpIds = [];
    const playBtn = document.getElementById("trump-play-btn");
    if (playBtn) { playBtn.style.display = "none"; playBtn.textContent = "選択したトランプを出す"; }
  } catch (e) { dbg("submitTrumpPlay error: " + e.message, true); }
};

window.submitUnoPlay = async function () {
  if (selectedUnoIdx === null) return;
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "uno") return;
    
    const myHand = (g.unoHands && g.unoHands[state.myId]) || [];
    const card   = myHand[selectedUnoIdx]; if (!card) return;
    
    // ワイルドカードの場合は色選択ピッカーを表示して待機
    if (card.t === "w" || card.t === "w4") {
      pendingUnoIdx = selectedUnoIdx;
      document.getElementById("cpick")?.classList.add("show");
      selectedUnoIdx = null;
      document.getElementById("uno-play-btn").style.display = "none";
      return;
    }
    
    // 通常の数字・記号カードはそのまま確定送信
    const playIdx = selectedUnoIdx;
    selectedUnoIdx = null;
    document.getElementById("uno-play-btn").style.display = "none";
    await doUnoPlay(playIdx, null);
  } catch (e) { dbg("submitUnoPlay error: " + e.message, true); }
};

// ========================================
// UNOカードを引く
// ========================================
window.unoDraw = async function () {
  try {
    const room = await fbGet("rooms/" + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== "uno") return;
    const pname       = room.players.find(p => p.id === state.myId)?.name || state.myName;
    
    // 現在のトランプパスカウントを記憶
    const currentPassCount = room.trumpPassCount || 0;

    const { g: newG, logMsg } = applyUnoDraw(g, state.myId, pname);
    const logs = [...(room.log || []), logMsg];

    // ⚡️カードを引いて手番が次の人に移動したタイミングでも、全員パスが成立していれば場を流す
    const fCards = Array.isArray(newG.trumpField) ? newG.trumpField : [];
    if (fCards.length > 0 && currentPassCount >= newG.order.length - 1 && newG.order.length > 0) {
      const nextPlayerId = newG.order[newG.ci];
      newG.trumpField = [];          // 場を空にする
      newG.hasParent  = nextPlayerId; // スキップ等も考慮された次の人に親権限を付与
      
      const parentName = room.players.find(p => p.id === nextPlayerId)?.name || "?";
      logs.push(`全員パス！場が流れた 👑 ${parentName}が親になった`);

      await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: 0 });
    } else {
      await fbUpdate("rooms/" + state.roomId, { game: newG, log: logs.slice(-8) });
    }
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
    await fbUpdate("rooms/" + state.roomId, { g: g, log: logs.slice(-8) });
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
// ロ lobbyへ戻る（元のまま流用）
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

