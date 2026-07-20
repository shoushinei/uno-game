// ========================================
// app.ts — エントリポイント
//
// 責務：
//   1. auth.ts を副作用としてロード（認証・ルーム管理の起動）
//   2. Firebaseリスナーの開始・停止
//   3. HTMLの onclick="..." から呼ばれる window.* 関数の登録
//      ※ 実際の処理は game-actions.ts / ui-input.ts に委譲する
//
// この層に「ゲームルール」や「Firebase書き込みロジック」を書かない。
// ========================================
import './auth.js';
import { clearSessionAndGoHome } from './auth.js';
import { auth } from './firebase-config.js';
import { markReactionFirst } from './account.js';
import { setPresenceRoom } from './presence.js';
import { state } from './state.js';
import { fbListen } from './db.js';
import './bot/test-bot.js';
import { startAbsentRunner } from './bot/absent-runner.js';
import { botPlayerMap } from './bot/lobby-bots.js';
import './replay/app.js'; // ★リプレイ機能で追加：リプレイ画面のwindow.*関数を登録する
import './ui/profile.js'; // ★Phase 2★ プロフィール画面（openProfile/closeProfile）を登録する
import './ui/friends-ui.js'; // ★Phase 4★ フレンド画面（openFriends 等）を登録する
import './ui/player-stats-card.js'; // ★戦績刷新★ 他人の戦績カード（席の長押し）を登録する
import { show, renderLobby, renderGame, renderResult, flashReactionBtn, dbg, setHomeMsg } from './ui/ui-render.js';
import { isPcUi } from './ui/pc/ui-mode.js';
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

// window オブジェクトに生やす関数の型宣言
// （index.html の onclick="..." から呼ばれるため window に公開する必要がある。
//   _currentGame / _currentTrumpHand / _roomState は test-bot.ts、
//   _startListening / _stopListening は auth.ts で宣言済み）
declare global {
  interface Window {
    startGame: () => Promise<void>;
    submitTrumpPlay: () => Promise<void>;
    trumpPass: () => Promise<void>;
    trumpSkip: () => Promise<void>;
    submitUnoPlay: () => Promise<void>;
    pickColor: (color: string) => Promise<void>;
    unoDraw: () => Promise<void>;
    unoSkip: () => Promise<void>;
    sayUno: () => Promise<void>;
    showParentColorPick: () => void;
    pickParentColor: (color: string) => Promise<void>;
    sendReaction: (emoji: string, targetId?: string) => Promise<void>;
    saveReplay: () => Promise<void>;
    openReplayScreen: () => void;
    closeReplayScreen: () => void;
    openRuleModal: () => void;
    closeRuleModal: (event?: Event) => void;
    // ★Phase C4 / ロビーボット★ 退室者・ボット代行が参照する同期情報
    _roomHost: string | null;
    _leftPlayers: Record<string, boolean>;
    _botPlayers: Record<string, boolean>;
  }
}

// ========================================
// ★追加：状態スナップショット詳細ログ化関数
// ========================================
function logSnapshot(reason: string): void {
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
export function startListening(): void {
  // ★Phase 4後半★ ルームに入ったら在席を「このルームで対戦中」に更新
  // （全てのルーム入室経路が startListening を通るため、ここ1箇所でよい）
  setPresenceRoom(state.roomId);
  if (state.unsubscribeRoom) state.unsubscribeRoom();
  state.unsubscribeRoom = fbListen(
    'rooms/' + state.roomId,
    (room) => {
      if (!room) return;

      // ★キック対応★ ロビー中に自分が players から消えていたら、
      // ホストに追い出されたということ。セッションを消してホームへ戻る
      // （自分から退出した場合は先にリスナーを止めるので、ここには来ない）。
      if (room.state === 'lobby' && state.myId &&
          Array.isArray(room.players) &&
          !room.players.some((p: any) => p.id === state.myId)) {
        window._stopListening?.();
        clearSessionAndGoHome();
        setHomeMsg('ホストによってロビーから退出させられました');
        return;
      }

      state.isHost = (room.host === state.myId);
      localStorage.setItem('savedIsHost', String(state.isHost));
      window._currentGame = room.game || null;
      window._roomState = room.state || null; // ★追加：モンキープレイのstate参照用
      // ★Phase C4★ 退室者代行（absent-runner）が参照する情報。
      // 代行はホストのクライアントだけが行うため host を、対象判定に
      // leftPlayers を公開する。
      window._roomHost = room.host || null;
      window._leftPlayers = room.leftPlayers || {};
      // ロビーで追加されたボット席（players の isBot 由来）も同じ代行対象
      window._botPlayers = botPlayerMap(room.players);
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
      // ★バグ修正（1人だけ同期が止まって古いターン表示のまま固まる）★
      // 描画中の例外が Firebase リスナーのコールバックまで波及すると、
      // 以降の同期通知が処理されなくなり、そのクライアントだけゲームが
      // 進まなくなる。描画エラーはここで握りつぶしてログに残し、
      // 同期自体は必ず生かし続ける。
      try {
      if (room.state === 'lobby') {
        renderLobby(room);
      } else if (room.state === 'playing') {
        // 従来UI（s-game）とPC向け新UI（s-game-pc）のどちらかがアクティブなら
        // 画面切り替え済みとみなす（show('game') が内部でどちらを使うかを判定する）
        const gameActive =
          document.getElementById('s-game')!.classList.contains('active') ||
          document.getElementById('s-game-pc')?.classList.contains('active');
        if (!gameActive) show('game');
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
        if (!document.getElementById('s-result')!.classList.contains('active')) {
          show('result');
        }
        renderResult(room);
        // ★修正★ ゲーム終了で自動プレイをOFFにする（次のゲームへ引き継がない）。
        // ローカルのボットタイマーと autoPlayers/{myId} を落とす
        window.stopAutoPlayOnGameEnd?.();
      }
      } catch (e: any) {
        console.error('画面描画でエラーが発生しました（同期は継続します）:', e);
        dbg('描画エラー: ' + e.message, true);
      }
    },
    (err) => { dbg('同期エラー: ' + err.message, true); logSnapshot('同期エラー: ' + err.message); } // ★ログ追加
  );
}

export function stopListening(): void {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }
}

// auth.ts から循環参照なしで参照できるよう公開
window._startListening = startListening;
window._stopListening  = stopListening;

// ★Phase C4★ 退室者の手番をホストが代行する監視を起動する
// （ホストのクライアントでのみ実際に動作する。軽量なので常時起動でよい）
startAbsentRunner();

// ========================================
// window.* 登録（HTML onclick から呼ばれる）
// すべて game-actions.ts に委譲し、エラーは dbg に流す
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
// targetId を渡すと特定プレイヤー宛ての「対人リアクション」になる
// （PC UIの席クリックメニューから）。省略時は従来の全体向け自己リアクション。
window.sendReaction = async (emoji, targetId) => {
  if (state.reactionCooldown) return;
  state.reactionCooldown = true;
  state.lastSentReaction = emoji;
  // PC UIでは自分のリアクションも席バブル（reactions同期→_runReactionEffects）で
  // 表示されるため、旧・中央ポップの flashReactionBtn は従来UIのときだけ呼ぶ
  // （二重表示防止）。
  if (!isPcUi()) flashReactionBtn(emoji);
  const result = await actionSendReaction(emoji, targetId);
  if (result?.error) { dbg(result.error, true); logSnapshot(result.error); } // ★ログ追加
  // ★Phase 3★ 対人リアクション（targetId付き）初送信の実績を立てる
  // （アカウント保持者のみ。ゲスト＝匿名は対象外）
  if (targetId && !result?.error) {
    const u = auth.currentUser;
    if (u && !u.isAnonymous) void markReactionFirst(u.uid);
  }
  setTimeout(() => { state.reactionCooldown = false; }, 2000);
};

// ========================================
// ★リプレイ機能で追加★ リプレイ保存（リザルト画面の「📼 リプレイを保存」ボタン用）
// ========================================
window.saveReplay = async () => {
  // ★バグ修正★ 以前は結果を dbg()（ホーム画面のデバッグログ欄）にしか
  // 出力しておらず、リザルト画面からはエラーが一切見えなかった
  // （＝ボタンを押しても「無反応」に見えていた）。
  // リザルト画面内の #replay-save-msg に成否を表示する。
  const msgEl = document.getElementById('replay-save-msg');
  const setMsg = (text: string, isErr: boolean) => {
    if (msgEl) {
      msgEl.textContent = text;
      msgEl.className = 'msg' + (isErr ? ' err' : ' ok');
    }
  };
  try {
    setMsg('リプレイデータを取得中...', false);
    const { buildReplayFile, downloadReplayFile } = await import('./replay/io.js');
    const replay = await buildReplayFile(state.roomId);
    if (!replay) {
      setMsg('リプレイデータが見つかりません（このゲームはリプレイ非対応です）', true);
      dbg('リプレイデータが見つかりません（このゲームはリプレイ非対応です）', true);
      return;
    }
    downloadReplayFile(replay);
    setMsg(`✓ リプレイを保存しました（${replay.actionLog.length}手）`, false);
    dbg('リプレイを保存しました');
  } catch (e: any) {
    setMsg('保存に失敗しました: ' + e.message, true);
    dbg('saveReplay error: ' + e.message, true);
  }
};

// ========================================
// ★リプレイ機能で追加★ リプレイ再生画面の開閉
// （show() は ES モジュール内の関数で HTML の onclick からは直接呼べないため、
//   ここで window に橋渡しする。ホーム画面の「📼 保存したリプレイを見る」
//   ボタンとリプレイ画面の「← ホームへ戻る」ボタンから呼ばれる）
// ========================================
window.openReplayScreen = () => {
  show('replay');
};

window.closeReplayScreen = () => {
  show('home');
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
