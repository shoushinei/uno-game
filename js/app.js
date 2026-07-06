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
  actionUnoSkip,
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
      if (room.game?.trumpHands) {
        window._currentTrumpHand = room.game.trumpHands[state.myId] ?? [];
      }
      if (room.state === 'lobby') {
        renderLobby(room);
      } else if (room.state === 'playing') {
        if (!document.getElementById('s-game').classList.contains('active')) show('game');
        renderGame(room);
      } else if (room.state === 'ended') {
        if (!document.getElementById('s-game').classList.contains('active')) {
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
// 離脱防止（誤操作によるブラウザ閉じ・戻るボタン対策）
// ========================================
window.addEventListener('beforeunload', (event) => {
  // ルームIDが存在し、かつゲームが終了（ended）していない状態の時に警告を出す
  const currentGame = window._currentGame;
  if (state.roomId && currentGame && currentGame.state !== 'ended') {
    event.preventDefault();
    event.returnValue = 'ゲーム中ですが、本当に離脱しますか？';
    return 'ゲーム中ですが、本当に離脱しますか？';
  }
});

// ========================================
// デバッグ用：ランダム自動プレイ（モンキーテスト）
// ========================================
let monkeyTimer = null;
let lastStateSignature = ""; // ★追加：立ち往生検知用
let sameStateCount = 0;      // ★追加：立ち往生検知用

window.toggleMonkeyPlay = () => {
  const btn = document.getElementById('monkey-toggle-btn');
  
  if (monkeyTimer) {
    // 停止処理
    clearInterval(monkeyTimer);
    monkeyTimer = null;
    lastStateSignature = ""; // ★追加
    sameStateCount = 0;      // ★追加
    if (btn) {
      btn.textContent = "🐒 自動ON";
      btn.style.background = "#ff9800";
    }
    console.log("🐒 モンキープレイを停止しました");
    return;
  }

  // 開始処理
  if (btn) {
    btn.textContent = "🐒 自動OFF";
    btn.style.background = "#e74c3c"; // 稼働中は赤色に
  }
  console.log("🐒 モンキープレイを開始しました（1秒ごとに手番チェック）");

  monkeyTimer = setInterval(() => {
    const g = window._currentGame;
    if (!g || g.state !== 'playing') return; // ゲーム中以外はスルー

    // 自分の手番（ターン）かチェック
    const isMyTurn = g.order[g.ci] === state.myId;
    if (!isMyTurn) {
      // 自分の番じゃない時は監視カウンターをリセット
      lastStateSignature = ""; // ★追加
      sameStateCount = 0;      // ★追加
      return;
    }

    // ─── ★追加：スタック（立ち往生）の自動検知 ───
    const currentSignature = `${g.phase}-${g.ci}-${(window._currentTrumpHand || []).length}-${(g.unoHands?.[state.myId] || []).length}`;
    if (currentSignature === lastStateSignature) {
      sameStateCount++;
      if (sameStateCount >= 3) {
        logSnapshot("自動プレイがエラー等により進行不能（スタック）になりました。");
        window.toggleMonkeyPlay();
        return;
      }
    } else {
      lastStateSignature = currentSignature;
      sameStateCount = 0;
    }
    // ───────────────────────────────────────────

    // --- A. 特殊なポップアップ（色選択ピッカー）が出ている場合の処理 ---
    // ワイルドカードの色選択ピッカーが出ている場合
    const cpick = document.getElementById('cpick');
    if (cpick && cpick.classList.contains('show')) {
      const colorBtns = cpick.querySelectorAll('.cbtn');
      if (colorBtns.length > 0) {
        colorBtns[Math.floor(Math.random() * colorBtns.length)].click();
        return;
      }
    }
    // 親の強制色変更ピッカーが出ている場合
    const parentCpick = document.getElementById('parent-cpick');
    if (parentCpick && parentCpick.classList.contains('show')) {
      const pColorBtns = parentCpick.querySelectorAll('.cbtn');
      if (pColorBtns.length > 0) {
        pColorBtns[Math.floor(Math.random() * pColorBtns.length)].click();
        return;
      }
    }

    // --- B. 通常の手番行動（表示されているボタンに応じてランダム行動） ---
    if (g.phase === 'trump') {
      // スキップボタンが出ているなら押す（手札0枚）
      const skipBtn = document.getElementById('trump-skip-btn');
      if (skipBtn && skipBtn.style.display !== 'none') {
        window.trumpSkip();
        return;
      }

      // 確率30%でパスを選択
      const passBtn = document.getElementById('trump-pass-btn');
      if (passBtn && passBtn.style.display !== 'none' && Math.random() < 0.3) {
        window.trumpPass();
        return;
      }

      // それ以外は手札をランダムに選んで出す
      const checkboxes = document.querySelectorAll('#my-trump-hand input[type="checkbox"]');
      if (checkboxes.length > 0) {
        // すべてのチェックを一旦外す
        checkboxes.forEach(cb => cb.checked = false);
        // ランダムに1枚だけチェックを入れる（複数枚出しのバグ検証をしたい場合はここを調整）
        const randomCb = checkboxes[Math.floor(Math.random() * checkboxes.length)];
        randomCb.checked = true;
        
        window.submitTrumpPlay();
      } else {
        // 万が一チェックボックスがなければパス
        if (passBtn && passBtn.style.display !== 'none') window.trumpPass();
      }

    } else if (g.phase === 'uno') {
      // スキップボタンが出ているなら押す（手札0枚）
      const skipBtn = document.getElementById('uno-skip-btn');
      if (skipBtn && skipBtn.style.display !== 'none') {
        window.unoSkip();
        return;
      }

      // 残り手札1枚になりそうなら50%の確率で「UNO!」と叫ぶ
      const unoBtn = document.getElementById('uno-btn');
      if (unoBtn && unoBtn.style.display !== 'none' && Math.random() < 0.5) {
        window.sayUno();
        return;
      }

      // 確率70%で手札を出そうと試みる
      if (Math.random() < 0.7) {
        const unoCards = document.querySelectorAll('#my-uno-hand .uno-card, #my-uno-hand [data-idx]');
        if (unoCards.length > 0) {
          const randomCard = unoCards[Math.floor(Math.random() * unoCards.length)];
          randomCard.click(); // 画面上の手札をクリック（選択状態にする）
          window.submitUnoPlay();
          return;
        }
      }

      // 出さなかった、または出せなかった場合はドローボタンを押す
      const drawBtn = document.getElementById('uno-draw-btn');
      if (drawBtn && drawBtn.style.display !== 'none') {
        window.unoDraw();
      }
    }

  }, 1000); // 1秒ごとにチェック＆行動
};