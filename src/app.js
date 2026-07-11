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
import './bot/test-bot.ts';
import './replay/app.js'; // ★リプレイ機能で追加：リプレイ画面のwindow.*関数を登録する
import { show, renderLobby, renderGame, renderResult, flashReactionBtn, dbg } from './ui-render.js';
import {
  actionStartGame,
  actionTrumpPlay,
  actionTrumpPass,
  actionTrumpSkip,
  actionUnoPlay,
  actionUnoDraw,
  actionUnoSkip,
  actionSayUno,
  actionPickParentColor,
  actionSendReaction,
} from './actions/game-actions.js';
import {
  getSelectedTrumpIds,
  getSelectedUnoIdx,
  getPendingUnoIdx,
  setPendingUnoIdx,
  resetTrumpSelection,
  resetUnoSelection,
} from './ui/ui-input.js';

// ========================================
// ★追加：状態スナップショット詳細ログ化関数
// ========================================
function logSnapshot(reason) {
  console.error(`🚨 【ゲーム状態スナップショット】\n理由/エラー: ${reason}`);
  console.log(`⏰ 時刻: ${new Date().toLocaleTimeString()}`);
  console.log(`👤 プレイヤー: ${state.myName || '未設定'} (ID: ${state.myId || 'なし'}) / 部屋主: ${state.isHost}`);
  
  if (window._currentGame) {
    console.log("▼ ─── 現在のゲームデータ (window._currentGame) ───");
    console.dir(window._currentGame);
  } else {
    console.log("❌ ゲームデータ(window._currentGame)は null です");
  }
  
  console.log("▼ ─── 自分のトランプ手札 (window._currentTrumpHand) ───");
  console.dir(window._currentTrumpHand || []);
  console.log("────────────────────────────────────────");
}

// ========================================
// リアルタイムリスナー
// ========================================
export function startListening() {
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = fbListen(
    'rooms/' + state.roomId,
    (room) => {
      if (!room) return;
      state.isHost = (room.host === state.myId);
      localStorage.setItem('savedIsHost', String(state.isHost));
      window._currentGame = room.game || null;
      window._roomState = room.state || null; // ★追加：モンキープレイのstate参照用
      // ★バグ修正（Firebase Realtime Databaseの空配列対策仕様）★
      // 全員のトランプ手札が0枚になると room.game.trumpHands ノード自体が
      // 丸ごと削除されて undefined になる（前回までに直したゲームロジック側と
      // 同じ現象）。以前は `if (room.game?.trumpHands)` の中でしか
      // window._currentTrumpHand を更新していなかったため、この条件が
      // falsy になった瞬間から更新が一切走らなくなり、最後にプレイした
      // 直前の「まだ手札が残っている」という古い値が永久に固定されて
      // しまっていた（テストボットがこれだけを見ているため、実際には
      // 0枚になったカードを延々と出そうとして進行不能になっていた）。
      // room.game?.trumpHands が無い場合も含めて、毎回必ず（空配列も込みで）
      // 更新する。
      window._currentTrumpHand = room.game?.trumpHands?.[state.myId] ?? [];
      if (room.state === 'lobby') {
        renderLobby(room);
      } else if (room.state === 'playing') {
        if (!document.getElementById('s-game').classList.contains('active')) show('game');
        renderGame(room);
      } else if (room.state === 'ended') {
        // ★バグ修正★ 条件が反転していた。以前は「s-game画面がアクティブ
        // "ではない"時だけ結果画面に切り替える」になっており、実際には
        // 一番切り替えが必要な「今まさにゲーム画面を見ている人」の場合に
        // 限って show('result') がスキップされてしまっていた。
        // サーバー側ではゲームが終了・順位も確定済みなのに、そのプレイヤー
        // だけ画面がゲーム中のまま固定表示され続け（手札も最後に同期された
        // 古い状態のまま）、カードを出そうとしても「ゲームは既に終了して
        // いる」という理由でサーバーに拒否され続ける、という不具合の原因
        // だった。正しくは「まだ結果画面がアクティブでない時だけ切り替える」
        // （＝重複切り替えを避けるための判定）にする。
        if (!document.getElementById('s-result').classList.contains('active')) {
          show('result');
        }
        renderResult(room);
      }
    },
    (err) => { dbg('同期エラー: ' + err.message, true); logSnapshot('同期エラー: ' + err.message); } // ★ログ追加
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
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

// --- トランプ ---
window.submitTrumpPlay = async () => {
  const ids = getSelectedTrumpIds();
  const result = await actionTrumpPlay(ids);
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); return; } // ★ログ追加
  resetTrumpSelection();
};

window.trumpPass = async () => {
  const result = await actionTrumpPass();
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

window.trumpSkip = async () => {
  const result = await actionTrumpSkip();
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

// --- UNO ---
window.submitUnoPlay = async () => {
  const idx = getSelectedUnoIdx();
  if (idx === null) return;

  // ★バグ修正★ 自分のターンでない場合は色ピッカーを開く前に弾く。
  // 以前はターンチェックをせずワイルドカード判定だけで色ピッカーを表示していたため、
  // 他人のターン中でも色選択UIが操作可能になってしまっていた。
  const g = window._currentGame;
  const isMyTurn = g && g.order[g.ci] === state.myId;
  if (!g || !isMyTurn || g.phase !== 'uno') {
    dbg('自分のターン（UNOフェイズ）ではありません', true);
    logSnapshot('自分のターン（UNOフェイズ）ではありません'); // ★ログ追加
    resetUnoSelection();
    return;
  }

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
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); resetUnoSelection(); return; } // ★ログ追加
  resetUnoSelection();
};

window.pickColor = async (color) => {
  document.getElementById('cpick')?.classList.remove('show');
  const pendingIdx = getPendingUnoIdx();
  if (pendingIdx === null) return;
  setPendingUnoIdx(null);
  const result = await actionUnoPlay(pendingIdx, color);
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

window.unoDraw = async () => {
  const result = await actionUnoDraw();
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

window.unoSkip = async () => {
  const result = await actionUnoSkip();
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

window.sayUno = async () => {
  const result = await actionSayUno();
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

// --- 親の権限 ---
window.showParentColorPick = () => {
  document.getElementById('parent-cpick')?.classList.add('show');
};

window.pickParentColor = async (color) => {
  document.getElementById('parent-cpick')?.classList.remove('show');
  const result = await actionPickParentColor(color);
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
};

// --- リアクション ---
window.sendReaction = async (emoji) => {
  if (state.reactionCooldown) return;
  state.reactionCooldown = true;
  state.lastSentReaction = emoji;
  flashReactionBtn(emoji);
  const result = await actionSendReaction(emoji);
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};

// ========================================
// ★リプレイ機能で追加★ リプレイ保存（リザルト画面の「📼 リプレイを保存」ボタン用）
// ========================================
window.saveReplay = async () => {
  const { buildReplayFile, downloadReplayFile } = await import('./replay/io.js');
  const replay = await buildReplayFile(state.roomId);
  if (!replay) {
    dbg('リプレイデータが見つかりません（このゲームはリプレイ非対応です）', true);
    return;
  }
  downloadReplayFile(replay);
  dbg('リプレイを保存しました');
};

// ========================================
// 離脱防止（誤操作によるブラウザ閉じ・戻るボタン対策）
// ========================================
window.addEventListener('beforeunload', (event) => {
  // ルームIDが存在し、かつゲームが終了（ended）していない状態の時に警告を出す
  // ★バグ修正★ currentGame.state は room.game 側には存在しないフィールドで、
  // 常に undefined（≠ 'ended'）になるため、ゲーム終了後もこの警告が
  // 出続けてしまっていた。room.state を保持している window._roomState を見る。
  if (state.roomId && window._roomState && window._roomState !== 'ended') {
    event.preventDefault();
    event.returnValue = 'ゲーム中ですが、本当に離脱しますか？';
    return 'ゲーム中ですが、本当に離脱しますか？';
  }
});

// ========================================
// ルール説明モーダル（ポップアップ）開閉
// ========================================
window.openRuleModal = () => {
  const modal = document.getElementById('rule-modal');
  if (modal) modal.style.display = 'flex';
};

window.closeRuleModal = (event) => {
  // 背景クリックまたはボタンクリックで閉じる
  const modal = document.getElementById('rule-modal');
  if (modal) modal.style.display = 'none';
};
