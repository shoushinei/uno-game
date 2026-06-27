// ========================================
// UI 入力制御モジュール
// カードの選択状態をローカルで管理し、
// 送信確定前のDOMだけを高速更新する責務を担う。
// ゲームロジックの「判定関数」をwindowに公開することで
// ui-render.js から参照できるようにする。
// ========================================
import { trumpCanPlay, trumpStrength } from './trump-logic.js';
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
// ゲームロジックの判定関数をwindowに公開
// ui-render.js がDOMを生成する際に参照する
// ----------------------------------------

/**
 * UNOカードが出せるか判定する（ui-render.js から参照）
 */
window.unoCanPlayCard = function (card, topUno, currentColor, penaltyAccum) {
  return unoCanPlay(card, topUno, currentColor, penaltyAccum);
};

/**
 * トランプカードが選択可能か判定する（ui-render.js から参照）
 * 複数枚選択中は「同ランクのカード」のみ追加選択可能
 */
window.trumpCanPlayCard = function (card, fieldCards, currentSelectedIds) {
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];

  // 選択済みのカードは常にtrue（解除操作のため）
  if (currentSelectedIds.length > 0 && currentSelectedIds.includes(card.id)) return true;

  const hand = window._currentTrumpHand || [];

  // 1枚目の選択判定
  if (currentSelectedIds.length === 0) {
    if (fCards.length === 0) return true;
    const fNonJoker = fCards.filter(c => c.v !== 'JOKER');
    const fValue = fNonJoker.length > 0 ? fNonJoker[0].v : 'JOKER';
    return trumpStrength(card) > trumpStrength({ v: fValue });
  }

  // 2枚目以降の選択判定：最初のカードと同じ数字（またはJOKER）のみ
  const firstCard = hand.find(c => c.id === currentSelectedIds[0]);
  if (!firstCard) return false;
  if (card.v !== firstCard.v && card.v !== 'JOKER' && firstCard.v !== 'JOKER') return false;

  // 場にカードがある場合は場の枚数を超えて選択できない
  if (fCards.length > 0 && currentSelectedIds.length >= fCards.length) return false;

  return true;
};

// app.js がリスナー更新時に現在の手札をここに書き込む
window._currentTrumpHand = [];

// ----------------------------------------
// トランプ手札のDOM選択状態を即時更新する（Firebase不使用）
// ----------------------------------------
function refreshTrumpHandDisplay() {
  const el = document.getElementById('my-trump-hand'); if (!el) return;
  el.querySelectorAll('.trump-hand-card').forEach(div => {
    const cardId = div.dataset.cardId;
    if (!cardId) return;
    const isSelected = selectedTrumpIds.includes(cardId);
    div.classList.toggle('selected', isSelected);

    if (selectedTrumpIds.length > 0 && !isSelected) {
      const firstV = window._currentTrumpHand?.find(c => c.id === selectedTrumpIds[0])?.v;
      const thisV  = window._currentTrumpHand?.find(c => c.id === cardId)?.v;
      if (firstV !== undefined && firstV !== thisV) {
        div.classList.add('off');
        div.onclick = null;
      }
    } else {
      if (div.dataset.canPlay === '1' || isSelected) {
        div.classList.remove('off');
        div.onclick = () => window.selectTrumpCard(cardId);
      }
    }
  });
}

// ----------------------------------------
// UNO手札のDOM選択状態を即時更新する
// ----------------------------------------
function refreshUnoHandDisplay() {
  const el = document.getElementById('my-uno-hand'); if (!el) return;
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
  const hand = window._currentTrumpHand;

  if (selectedTrumpIds.includes(cardId)) {
    selectedTrumpIds = selectedTrumpIds.filter(id => id !== cardId);
  } else {
    if (selectedTrumpIds.length === 0) {
      selectedTrumpIds.push(cardId);
    } else {
      const firstV = hand.find(c => c.id === selectedTrumpIds[0])?.v;
      const thisV  = hand.find(c => c.id === cardId)?.v;
      if (firstV !== undefined && firstV === thisV) {
        selectedTrumpIds.push(cardId);
      }
    }
  }

  const playBtn = document.getElementById('trump-play-btn');
  if (playBtn) {
    if (selectedTrumpIds.length > 0) {
      playBtn.style.display = 'inline-block';
      playBtn.textContent = selectedTrumpIds.length === 1
        ? '選択したトランプを出す'
        : `選択した ${selectedTrumpIds.length} 枚を出す`;
    } else {
      playBtn.style.display = 'none';
    }
  }

  refreshTrumpHandDisplay();
};

// ----------------------------------------
// UNOカードの選択／解除
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
  const playBtn = document.getElementById('trump-play-btn');
  if (playBtn) {
    playBtn.style.display = 'none';
    playBtn.textContent = '選択したトランプを出す';
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
