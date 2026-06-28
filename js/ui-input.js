// ========================================
// UI 入力管理モジュール
//
// 責務：
//   - カードの選択状態をローカルで管理する
//   - 送信確認前のDOMだけをリアルタイム更新する
//   - ゲームロジックの「判定関数」を window に公開することで
//     ui-render.js から呼び出せるようにする
// ========================================
import { trumpCanPlay } from './trump-logic.js';
import { unoCanPlay } from './uno-logic.js';

// ----------------------------------------
// カード選択状態（モジュールスコープ）
// ----------------------------------------
let selectedTrumpIds = [];
let selectedUnoIdx = null;
let pendingUnoIdx = null;

// ui-render.js・app.js から読み取り専用で参照できるよう公開
Object.defineProperty(window, '_selectedTrumpIds', { get: () => selectedTrumpIds });
Object.defineProperty(window, '_selectedUnoIdx',   { get: () => selectedUnoIdx });

// ----------------------------------------
// ゲームロジックの判定関数を window に公開
// ui-render.js が DOM を生成する際に参照する
// ----------------------------------------

/**
 * UNO カードが出せるか判定する（ui-render.js から呼び出し）
 */
window.unoCanPlayCard = function (card, topUno, currentColor, penaltyAccum) {
  return unoCanPlay(card, topUno, currentColor, penaltyAccum);
};

/**
 * トランプカードが選択可能か判定する（ui-render.js から呼び出し）
 *
 * 判定ロジック：
 *  - 既に選択中のカードは常に true（選択解除できる）
 *  - 場の枚数に達していたら追加不可
 *  - 場が空・選択途中の場合は、追加後の組み合わせが
 *    analyzeTrumpPlay で valid になるかで判定
 */
window.trumpCanPlayCard = function (card, fieldCards, currentSelectedIds) {
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];
  const selectedIds = Array.isArray(currentSelectedIds) ? currentSelectedIds : [];

  // 既に選択中のカードは解除のために常に true
  if (selectedIds.includes(card.id)) return true;

  // 場のカードがあり、選択枚数が場の枚数に達していたら追加不可
  if (fCards.length > 0 && selectedIds.length >= fCards.length) return false;

  const g = window._currentGame || {};

  // 試しにこのカードを追加した状態で valid かチェック
  const nextCards = selectedTrumpCards([...selectedIds, card.id]);

  // 場が空で既に選択がある場合：同数字か階段の可能性があれば許可
  if (fCards.length === 0 && selectedIds.length > 0) return true;

  // 場の枚数に満たない途中段階も許可（まだ揃えている最中）
  if (fCards.length > 0 && nextCards.length < fCards.length) return true;

  return trumpCanPlay(nextCards, fCards, g) || fCards.length === 0;
};

// app.js がリスナー更新時に現在の状態をここに書き込む
window._currentTrumpHand = [];
window._currentGame = null;

// ---- ヘルパー：選択ID から手札オブジェクト配列を返す ----
function selectedTrumpCards(ids = selectedTrumpIds) {
  const hand = window._currentTrumpHand || [];
  return ids.map(id => hand.find(c => c.id === id)).filter(Boolean);
}

// ---- 提出ボタンの有効/無効を更新する ----
function updateTrumpPlayButton() {
  const playBtn = document.getElementById('trump-play-btn');
  if (!playBtn) return;

  if (selectedTrumpIds.length === 0) {
    playBtn.style.display = 'none';
    playBtn.disabled = false;
    return;
  }

  const g = window._currentGame || {};
  const canSubmit = trumpCanPlay(selectedTrumpCards(), g.trumpField || [], g);
  playBtn.style.display = 'inline-block';
  playBtn.disabled = !canSubmit;
  playBtn.textContent = selectedTrumpIds.length === 1
    ? 'トランプを出す'
    : `${selectedTrumpIds.length}枚のトランプを出す`;
}

// ----------------------------------------
// トランプ手札の DOM 選択状態をリアルタイム更新する
// （Firebase を使わずに即時反映させる）
// ----------------------------------------
function refreshTrumpHandDisplay() {
  const el = document.getElementById('my-trump-hand');
  if (!el) return;
  el.querySelectorAll('.trump-hand-card').forEach(div => {
    const cardId = div.dataset.cardId;
    if (!cardId) return;
    const isSelected = selectedTrumpIds.includes(cardId);
    const card = (window._currentTrumpHand || []).find(c => c.id === cardId);
    const canSelect = card
      ? window.trumpCanPlayCard(card, window._currentGame?.trumpField || [], selectedTrumpIds)
      : false;
    div.classList.toggle('selected', isSelected);
    div.classList.toggle('off', !canSelect && !isSelected);
    div.onclick = (canSelect || isSelected) ? () => window.selectTrumpCard(cardId) : null;
  });
}

// ----------------------------------------
// UNO 手札の DOM 選択状態をリアルタイム更新する
// ----------------------------------------
function refreshUnoHandDisplay() {
  const el = document.getElementById('my-uno-hand');
  if (!el) return;
  el.querySelectorAll('.hcd').forEach(div => {
    const idxStr = div.dataset.cardIdx;
    if (idxStr === undefined) return;
    const idx = parseInt(idxStr, 10);
    div.classList.toggle('selected', idx === selectedUnoIdx);
  });
}

// ----------------------------------------
// トランプカードの選択／解除
// ----------------------------------------
window.selectTrumpCard = function (cardId) {
  if (selectedTrumpIds.includes(cardId)) {
    // 解除
    selectedTrumpIds = selectedTrumpIds.filter(id => id !== cardId);
  } else {
    // 追加：追加後に valid かを確認してから追加する
    const card = (window._currentTrumpHand || []).find(c => c.id === cardId);
    if (card && window.trumpCanPlayCard(card, window._currentGame?.trumpField || [], selectedTrumpIds)) {
      selectedTrumpIds.push(cardId);
    }
  }
  updateTrumpPlayButton();
  refreshTrumpHandDisplay();
};

// ----------------------------------------
// UNO カードの選択／解除
// ----------------------------------------
window.selectUnoCard = function (idx) {
  selectedUnoIdx = (selectedUnoIdx === idx) ? null : idx;

  const playBtn = document.getElementById('uno-play-btn');
  if (playBtn) {
    playBtn.style.display = selectedUnoIdx !== null ? 'inline-block' : 'none';
  }

  refreshUnoHandDisplay();
};

// ----------------------------------------
// 選択状態のリセット（app.js からカード送信後に呼ぶ）
// ----------------------------------------
export function resetTrumpSelection() {
  selectedTrumpIds = [];
  updateTrumpPlayButton();
  const playBtn = document.getElementById('trump-play-btn');
  if (playBtn) {
    playBtn.style.display = 'none';
    playBtn.disabled = false;
    playBtn.textContent = 'トランプを出す';
  }
}

export function resetUnoSelection() {
  selectedUnoIdx = null;
  pendingUnoIdx = null;
  const playBtn = document.getElementById('uno-play-btn');
  if (playBtn) playBtn.style.display = 'none';
}

// ----------------------------------------
// ワイルドカード選択待ち状態の管理
// ----------------------------------------
export function setPendingUnoIdx(idx) {
  pendingUnoIdx = idx;
}

export function getPendingUnoIdx() {
  return pendingUnoIdx;
}

export function getSelectedTrumpIds() {
  return [...selectedTrumpIds];
}

export function getSelectedUnoIdx() {
  return selectedUnoIdx;
}
