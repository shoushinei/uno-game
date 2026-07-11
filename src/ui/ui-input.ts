// ========================================
// UI 入力管理モジュール
//
// 責務：
//   - カードの選択状態をローカルで管理する
//   - 送信確認前のDOMだけをリアルタイム更新する
//   - ゲームロジックの「判定関数」を window に公開することで
//     ui-render.js から呼び出せるようにする
// ========================================
import { trumpCanPlay, type TrumpCard } from '../logic/trump-logic.js';
import { unoCanPlay } from '../logic/uno-logic.js';
import type { UnoCard } from '../logic/types';

// window オブジェクトに生やすプロパティ・関数の型宣言
// （_currentGame / _currentTrumpHand / _roomState は test-bot.ts で既に宣言済みのため、
//   ここではこのファイルが新たに追加するものだけを宣言する）
declare global {
  interface Window {
    _selectedTrumpIds: string[];
    _selectedUnoIdx: number | null;
    unoCanPlayCard: (card: UnoCard, topUno: UnoCard, currentColor: string, penaltyAccum: number) => boolean;
    trumpCanPlayCard: (card: TrumpCard, fieldCards: TrumpCard[], currentSelectedIds: string[]) => boolean;
    selectTrumpCard: (cardId: string) => void;
    selectUnoCard: (idx: number) => void;
  }
}

// ----------------------------------------
// カード選択状態（モジュールスコープ）
// ----------------------------------------
let selectedTrumpIds: string[] = [];
let selectedUnoIdx: number | null = null;
let pendingUnoIdx: number | null = null;

// ui-render.js・app.js から読み取り専用で参照できるよう公開
// ★修正★ configurable: true を付与する。
// これが無いと、モジュールが何らかの理由で複数回評価された場合
// （例：テストで vi.resetModules() を使って再インポートするケースや、
// 開発中のホットリロードなど）に「Cannot redefine property」で
// クラッシュしてしまう。configurable: true にしておけば、
// 同じ window オブジェクトに対して安全に再定義できる。
Object.defineProperty(window, '_selectedTrumpIds', { get: () => selectedTrumpIds, configurable: true });
Object.defineProperty(window, '_selectedUnoIdx',   { get: () => selectedUnoIdx,   configurable: true });

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

  const g = window._currentGame;

  // 試しにこのカードを追加した状態で valid かチェック
  const nextCards = selectedTrumpCards([...selectedIds, card.id]);

  // 場が空で既に選択がある場合：同数字か階段の可能性があれば許可
  if (fCards.length === 0 && selectedIds.length > 0) return true;

  // 場の枚数に満たない途中段階も許可（まだ揃えている最中）
  if (fCards.length > 0 && nextCards.length < fCards.length) return true;

  return trumpCanPlay(nextCards, fCards, g ?? undefined) || fCards.length === 0;
};

// app.js がリスナー更新時に現在の状態をここに書き込む
window._currentTrumpHand = [];
window._currentGame = null;

// ---- ヘルパー：選択ID から手札オブジェクト配列を返す ----
function selectedTrumpCards(ids: string[] = selectedTrumpIds): TrumpCard[] {
  const hand = window._currentTrumpHand || [];
  return ids
    .map(id => hand.find(c => c.id === id))
    .filter((c): c is TrumpCard => Boolean(c));
}

// ---- 提出ボタンの有効/無効を更新する ----
function updateTrumpPlayButton(): void {
  const playBtn = document.getElementById('trump-play-btn') as HTMLButtonElement | null;
  if (!playBtn) return;

  if (selectedTrumpIds.length === 0) {
    playBtn.style.display = 'none';
    playBtn.disabled = false;
    return;
  }

  const g = window._currentGame;
  const canSubmit = trumpCanPlay(selectedTrumpCards(), g?.trumpField || [], g ?? undefined);
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
function refreshTrumpHandDisplay(): void {
  const el = document.getElementById('my-trump-hand');
  if (!el) return;
  el.querySelectorAll<HTMLElement>('.trump-hand-card').forEach(div => {
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
function refreshUnoHandDisplay(): void {
  const el = document.getElementById('my-uno-hand');
  if (!el) return;
  el.querySelectorAll<HTMLElement>('.hcd').forEach(div => {
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
    (playBtn as HTMLElement).style.display = selectedUnoIdx !== null ? 'inline-block' : 'none';
  }

  refreshUnoHandDisplay();
};

// ----------------------------------------
// 選択状態のリセット（app.js からカード送信後に呼ぶ）
// ----------------------------------------
export function resetTrumpSelection(): void {
  selectedTrumpIds = [];
  updateTrumpPlayButton();
  const playBtn = document.getElementById('trump-play-btn') as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.style.display = 'none';
    playBtn.disabled = false;
    playBtn.textContent = 'トランプを出す';
  }
}

// ★バグ修正（ワイルドが出せない）★
// 以前はここで pendingUnoIdx も null にリセットしていた。
// ワイルドカードのフローは
//   カード選択 → selectUnoCard(idx) [selectedUnoIdx=idx]
//   → 送信 → setPendingUnoIdx(idx) → resetUnoSelection()（選択ハイライト/送信ボタンだけ消す）
//   → 色ピッカー表示 → pickColor(color) → getPendingUnoIdx() で idx を取り出して actionUnoPlay(idx, color)
// という順序で進むため、resetUnoSelection() が pendingUnoIdx まで消してしまうと
// pickColor() 時点で getPendingUnoIdx() が null を返し、
// actionUnoPlay(null, color) → myHand[null] === undefined → 出せない、という不具合になっていた。
//
// resetUnoSelection() は「見た目の選択状態（selectedUnoIdx・送信ボタン）」だけを
// リセットする責務に限定し、pendingUnoIdx のクリアは別関数 clearPendingUnoIdx() に分離する。
// pendingUnoIdx は「ワイルド色決定が実際に送信され終わった後」に
// 呼び出し側（app.js）が明示的に clearPendingUnoIdx() を呼んでクリアすること。
export function resetUnoSelection(): void {
  selectedUnoIdx = null;
  const playBtn = document.getElementById('uno-play-btn');
  if (playBtn) (playBtn as HTMLElement).style.display = 'none';
}

// ----------------------------------------
// ワイルドカード選択待ち状態の管理
// ----------------------------------------
export function setPendingUnoIdx(idx: number | null): void {
  pendingUnoIdx = idx;
}

export function getPendingUnoIdx(): number | null {
  return pendingUnoIdx;
}

// ワイルド色決定が完了した（送信済み・またはキャンセルされた）タイミングで
// 呼び出し側が明示的に呼び、pendingUnoIdx だけをクリアする。
export function clearPendingUnoIdx(): void {
  pendingUnoIdx = null;
}

export function getSelectedTrumpIds(): string[] {
  return [...selectedTrumpIds];
}

export function getSelectedUnoIdx(): number | null {
  return selectedUnoIdx;
}

// ----------------------------------------
// ★バグ修正（選択状態の残留）★ の中核ロジック
//
// これらは DOM に一切触れない純粋関数として切り出してある。
// ui-render.js の renderTrumpHand / renderUnoHand は「見た目上、選択済み扱いに
// してよいか」をここに問い合わせる。canAct（＝今まさに自分がこのフェイズを
// 操作できるか）が false のときは、window._selectedTrumpIds /
// window._selectedUnoIdx に古い値が残っていても、それを一切選択済みとして
// 扱わない。これにより、リセット呼び出しのタイミングに関係なく、
// 「自分の番ではない・出し終えたカードの残骸」が次の自分の番に持ち越されて
// 誤って選択済み表示になる不具合を防ぐ。
// ----------------------------------------
export function isTrumpCardVisiblySelected(cardId: string, selectedIds: string[] | null | undefined, canAct: unknown): boolean {
  return Boolean(canAct) && (selectedIds || []).includes(cardId);
}

export function isUnoCardVisiblySelected(idx: number, selectedIdx: number | null | undefined, canAct: unknown): boolean {
  return Boolean(canAct) && selectedIdx !== null && selectedIdx !== undefined && idx === selectedIdx;
}