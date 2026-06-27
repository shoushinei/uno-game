// ========================================
// メインコントローラー
// Firebaseリスナー管理とゲームアクション処理を担う。
// 認証・ルーム管理は auth.js に分離済み。
// ========================================
import { state } from './state.js';
import { fbGet, fbUpdate, fbSet, fbListen } from './db.js';
import { show, renderLobby, renderGame, renderResult, flashReactionBtn, dbg, setLobbyMsg } from './ui-render.js';
import { initFusionGame } from './game-init.js';
import { applyTrumpPlay, applyTrumpPass } from './trump-logic.js';
import { applyUnoPlay, applyUnoDraw } from './uno-logic.js';
import {
  getSelectedTrumpIds,
  getSelectedUnoIdx,
  getPendingUnoIdx,
  setPendingUnoIdx,
  resetTrumpSelection,
  resetUnoSelection,
} from './ui-input.js';

// ========================================
// リアルタイムリスナー
// ========================================
export function startListening() {
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = fbListen(
    'rooms/' + state.roomId,
    (room) => {
      if (!room) return;
      // ui-input.js の複数枚選択判定用に現在の手札を更新
      if (room.game && room.game.trumpHands) {
        window._currentTrumpHand = room.game.trumpHands[state.myId] || [];
      }
      if (room.state === 'lobby') {
        renderLobby(room);
      } else if (room.state === 'playing') {
        if (!document.getElementById('s-game').classList.contains('active')) show('game');
        renderGame(room);
      } else if (room.state === 'ended') {
        if (!document.getElementById('s-result').classList.contains('active')) {
          state.unsubscribeRoom && state.unsubscribeRoom();
          show('result');
        }
        renderResult(room);
      }
    },
    (err) => dbg('同期エラー: ' + err.message, true)
  );
}

export function stopListening() {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }
}

// auth.js から循環参照なしで参照できるようwindowに公開
window._startListening = startListening;
window._stopListening  = stopListening;

// ========================================
// ゲーム開始
// ========================================
window.startGame = async function () {
  try {
    const room    = await fbGet('rooms/' + state.roomId);
    if (!room || state.myId !== room.host) return;
    const players = room.players || [];
    if (players.length < 3) { setLobbyMsg('3人以上必要です'); return; }
    const game = initFusionGame(players);
    await fbUpdate('rooms/' + state.roomId, {
      state: 'playing',
      game,
      log: ['🎮 大富豪×UNO 融合ゲーム開始！'],
      trumpPassCount: 0,
    });
  } catch (e) { dbg('startGame error: ' + e.message, true); }
};

// ========================================
// トランプ：決定ボタン押下
// ========================================
window.submitTrumpPlay = async function () {
  const selectedTrumpIds = getSelectedTrumpIds();
  if (selectedTrumpIds.length === 0) return;
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    let g = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') return;

    const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
    if (fCards.length > 0 && selectedTrumpIds.length !== fCards.length) {
      dbg(`場の枚数（${fCards.length}枚）と一致させてください`, true);
      return;
    }

    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const result = applyTrumpPlay(g, state.myId, selectedTrumpIds, pname);
    if (!result) { dbg('選択したカードの組み合わせは出せません', true); return; }

    const logs = [...(room.log || []), result.logMsg];
    await fbUpdate('rooms/' + state.roomId, { game: result.g, log: logs.slice(-8), trumpPassCount: 0 });
    resetTrumpSelection();
  } catch (e) { dbg('submitTrumpPlay error: ' + e.message, true); }
};

// ========================================
// トランプ：パス
// ========================================
window.trumpPass = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') return;
    const pname     = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const passCount = (room.trumpPassCount || 0) + 1;
    const { g: newG, logMsg } = applyTrumpPass(g, state.myId, pname);
    const logs = [...(room.log || []), logMsg];
    await fbUpdate('rooms/' + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: passCount });
  } catch (e) { dbg('trumpPass error: ' + e.message, true); }
};

// ========================================
// トランプ：出し切り済みスキップ
// ========================================
window.trumpSkip = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') return;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    g.phase = 'uno';
    const logs = [...(room.log || []), `${pname}のトランプは0枚（自動スキップ）→ UNOフェイズへ`];
    await fbUpdate('rooms/' + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg('trumpSkip error: ' + e.message, true); }
};

// ========================================
// UNO：決定ボタン押下
// ========================================
window.submitUnoPlay = async function () {
  const selectedUnoIdx = getSelectedUnoIdx();
  if (selectedUnoIdx === null) return;
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== 'uno') return;

    const myHand = (g.unoHands && g.unoHands[state.myId]) || [];
    const card   = myHand[selectedUnoIdx]; if (!card) return;

    // ワイルドカードは色選択ピッカーを表示して待機
    if (card.t === 'w' || card.t === 'w4') {
      setPendingUnoIdx(selectedUnoIdx);
      document.getElementById('cpick')?.classList.add('show');
      resetUnoSelection();
      return;
    }

    const playIdx = selectedUnoIdx;
    resetUnoSelection();
    await doUnoPlay(playIdx, null);
  } catch (e) { dbg('submitUnoPlay error: ' + e.message, true); }
};

// ========================================
// UNO：色選択確定
// ========================================
window.pickColor = function (color) {
  document.getElementById('cpick')?.classList.remove('show');
  const pendingIdx = getPendingUnoIdx();
  if (pendingIdx === null) return;
  doUnoPlay(pendingIdx, color);
  setPendingUnoIdx(null);
};

// ========================================
// UNO：カードを出す（内部処理）
// ========================================
async function doUnoPlay(idx, chosenColor) {
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId) return;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;

    const currentPassCount = room.trumpPassCount || 0;

    const result = applyUnoPlay(g, state.myId, idx, chosenColor, pname);
    if (!result) return;
    const { g: newG, logMsg, isGameOver } = result;

    if (isGameOver) {
      newG.rankings.forEach(r => {
        if (r.name === '?') {
          const p = room.players.find(p2 => p2.id === r.id);
          if (p) r.name = p.name;
        }
      });
    }

    const logs = [...(room.log || []), logMsg];

    // UNOを出し終えた次のプレイヤーが確定したタイミングで全員パス判定
    const fCards = Array.isArray(newG.trumpField) ? newG.trumpField : [];
    if (fCards.length > 0 && currentPassCount >= newG.order.length - 1 && newG.order.length > 0) {
      const nextPlayerId = newG.order[newG.ci];
      newG.trumpField = [];
      newG.hasParent  = nextPlayerId;
      const parentName = room.players.find(p => p.id === nextPlayerId)?.name || '?';
      logs.push(`全員パス！場が流れた 👑 ${parentName}が親になった`);
      await fbUpdate('rooms/' + state.roomId, {
        game: newG,
        log:  logs.slice(-8),
        trumpPassCount: 0,
        ...(isGameOver ? { state: 'ended' } : {}),
      });
    } else {
      await fbUpdate('rooms/' + state.roomId, {
        game: newG,
        log:  logs.slice(-8),
        ...(isGameOver ? { state: 'ended' } : {}),
      });
    }
  } catch (e) { dbg('doUnoPlay error: ' + e.message, true); }
}

// ========================================
// UNO：カードを引く
// ========================================
window.unoDraw = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.order[g.ci] !== state.myId || g.phase !== 'uno') return;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;

    const currentPassCount = room.trumpPassCount || 0;
    const { g: newG, logMsg } = applyUnoDraw(g, state.myId, pname);
    const logs = [...(room.log || []), logMsg];

    const fCards = Array.isArray(newG.trumpField) ? newG.trumpField : [];
    if (fCards.length > 0 && currentPassCount >= newG.order.length - 1 && newG.order.length > 0) {
      const nextPlayerId = newG.order[newG.ci];
      newG.trumpField = [];
      newG.hasParent  = nextPlayerId;
      const parentName = room.players.find(p => p.id === nextPlayerId)?.name || '?';
      logs.push(`全員パス！場が流れた 👑 ${parentName}が親になった`);
      await fbUpdate('rooms/' + state.roomId, { game: newG, log: logs.slice(-8), trumpPassCount: 0 });
    } else {
      await fbUpdate('rooms/' + state.roomId, { game: newG, log: logs.slice(-8) });
    }
  } catch (e) { dbg('unoDraw error: ' + e.message, true); }
};

// ========================================
// UNO宣言
// ========================================
window.sayUno = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game; if (!g) return;
    if (!g.unoSaid) g.unoSaid = {};
    g.unoSaid[state.myId] = true;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const logs  = [...(room.log || []), `${pname}が「UNO！」と叫んだ 🎉`];
    await fbUpdate('rooms/' + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg('sayUno error: ' + e.message, true); }
};

// ========================================
// 親の権限：UNOの色を変更
// ========================================
window.showParentColorPick = function () {
  document.getElementById('parent-cpick')?.classList.add('show');
};

window.pickParentColor = async function (color) {
  document.getElementById('parent-cpick')?.classList.remove('show');
  try {
    const room = await fbGet('rooms/' + state.roomId); if (!room) return;
    const g    = room.game;
    if (!g || g.hasParent !== state.myId) return;
    g.unoCurrentColor = color;
    g.hasParent = null;
    const pname = room.players.find(p => p.id === state.myId)?.name || state.myName;
    const cname = { red: '赤', blue: '青', green: '緑', yellow: '黄' }[color] || color;
    const logs  = [...(room.log || []), `${pname}が親の権限でUNOの色を【${cname}】に変更！`];
    await fbUpdate('rooms/' + state.roomId, { game: g, log: logs.slice(-8) });
  } catch (e) { dbg('pickParentColor error: ' + e.message, true); }
};

// ========================================
// リアクション送信
// ========================================
window.sendReaction = async function (emoji) {
  if (state.reactionCooldown) return;
  state.reactionCooldown = true;
  state.lastSentReaction = emoji;
  flashReactionBtn(emoji);
  try {
    await fbSet(`rooms/${state.roomId}/reactions/${state.myId}`, { emoji, ts: Date.now() });
  } catch (e) { dbg('sendReaction error: ' + e.message, true); }
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};
