// ========================================
// app.js — エントリポイント
//
// 責務：
//   1. auth.js を副作用としてロード（認証・ルーム管理の起動）
//   2. Firebaseリスナーの開始・停止
//   3. HTMLの onclick="..." から呼ばれる window.* 関数の登録
//      ※ 実際の処理は game-actions.js / ui-input.js に委譲する
//
// この層に「ゲームルール」や「Firebase書き込みロジック」を書かない。
// ========================================
import './auth.js';
import { state } from './state.js';
import { fbListen } from './db.js';
import { show, renderLobby, renderGame, renderResult, flashReactionBtn, dbg } from './ui-render.js';
import {
  actionStartGame,
  actionTrumpPlay,
  actionTrumpPass,
  actionTrumpSkip,
  actionUnoPlay,
  actionUnoDraw,
  actionSayUno,
  actionPickParentColor,
  actionSendReaction,
} from './game-actions.js';
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
      window._currentGame = room.game || null;
      if (room.game?.trumpHands) {
        window._currentTrumpHand = room.game.trumpHands[state.myId] ?? [];
      }
      if (room.state === 'lobby') {
        renderLobby(room);
      } else if (room.state === 'playing') {
        if (!document.getElementById('s-game').classList.contains('active')) show('game');
        renderGame(room);
      } else if (room.state === 'ended') {
        if (!document.getElementById('s-result').classList.contains('active')) {
          stopListening();
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

// auth.js から循環参照なしで参照できるよう公開
window._startListening = startListening;
window._stopListening  = stopListening;

// ========================================
// window.* 登録（HTML onclick から呼ばれる）
// すべて game-actions.js に委譲し、エラーは dbg に流す
// ========================================

window.startGame = async () => {
  const result = await actionStartGame();
  if (result?.error) dbg(result.error, true);
};

// --- トランプ ---
window.submitTrumpPlay = async () => {
  const ids = getSelectedTrumpIds();
  const result = await actionTrumpPlay(ids);
  if (result?.error) { dbg(result.error, true); return; }
  resetTrumpSelection();
};

window.trumpPass = async () => {
  const result = await actionTrumpPass();
  if (result?.error) dbg(result.error, true);
};

window.trumpSkip = async () => {
  const result = await actionTrumpSkip();
  if (result?.error) dbg(result.error, true);
};

// --- UNO ---
window.submitUnoPlay = async () => {
  const idx = getSelectedUnoIdx();
  if (idx === null) return;

  // ワイルドカードは色ピッカーを先に表示
  const room = await (await import('./db.js')).fbGet('rooms/' + state.roomId);
  const card  = room?.game?.unoHands?.[state.myId]?.[idx];
  if (card && (card.t === 'w' || card.t === 'w4')) {
    setPendingUnoIdx(idx);
    document.getElementById('cpick')?.classList.add('show');
    resetUnoSelection();
    return;
  }

  const result = await actionUnoPlay(idx, null);
  if (result?.error) { dbg(result.error, true); return; }
  resetUnoSelection();
};

window.pickColor = async (color) => {
  document.getElementById('cpick')?.classList.remove('show');
  const pendingIdx = getPendingUnoIdx();
  if (pendingIdx === null) return;
  setPendingUnoIdx(null);
  const result = await actionUnoPlay(pendingIdx, color);
  if (result?.error) dbg(result.error, true);
};

window.unoDraw = async () => {
  const result = await actionUnoDraw();
  if (result?.error) dbg(result.error, true);
};

window.sayUno = async () => {
  const result = await actionSayUno();
  if (result?.error) dbg(result.error, true);
};

// --- 親の権限 ---
window.showParentColorPick = () => {
  document.getElementById('parent-cpick')?.classList.add('show');
};

window.pickParentColor = async (color) => {
  document.getElementById('parent-cpick')?.classList.remove('show');
  const result = await actionPickParentColor(color);
  if (result?.error) dbg(result.error, true);
};

// --- リアクション ---
window.sendReaction = async (emoji) => {
  if (state.reactionCooldown) return;
  state.reactionCooldown = true;
  state.lastSentReaction = emoji;
  flashReactionBtn(emoji);
  const result = await actionSendReaction(emoji);
  if (result?.error) dbg(result.error, true);
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};
