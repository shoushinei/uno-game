// ========================================
// test-bot.ts — テスト用自動プレイボット（開発・検証専用）
//
// 責務：
//   「出せるカードがあれば必ず出す」というシンプルな貪欲(greedy)ロジックで
//   自分の手番を自動的に進める。
//
// 設計方針：
//   - DOMのクラス名やチェックボックスを探してクリックを模倣する方式は、
//     UI側の実装（クラス名等）が変わるたびに静かに壊れて気づきにくい
//     （実際に前回発生した「全部パスする」「引くだけする」バグの原因）。
//   - そのため、DOMは一切見ず、window._currentGame / window._currentTrumpHand
//     から直接「今出せるカード」を計算し、game-actions.js の
//     actionTrumpPlay / actionUnoPlay 等を直接呼び出す。
//     「カードを選択してから送信する」という2ステップは、
//     actionTrumpPlay(cardIds) / actionUnoPlay(idx, color) という
//     1回の呼び出しに集約されるので、選択漏れが起こりようがない。
//
// ビルド：
//   trump-logic.ts と同様、ブラウザでは動かせないため
//   コンパイルして test-bot.js を生成し、index.html からは
//   .js の方を読み込む（.ts をそのまま <script> で読み込まない）。
//
// このファイルは本番運用では不要。index.html から
// <script type="module" src="js/test-bot.js"></script> の1行を
// 削除するだけで完全に無効化できる（app.js には一切変更不要）。
// ========================================

// @ts-ignore -- state.js はプレーンJS（型定義なし）
import { state } from './state.js';
// @ts-ignore -- game-actions.js はプレーンJS（型定義なし）
import {
  actionTrumpPlay,
  actionTrumpPass,
  actionTrumpSkip,
  actionUnoPlay,
  actionUnoDraw,
  actionUnoSkip,
  actionSayUno,
  actionPickParentColor,
} from './game-actions.js';
import { trumpCanPlay, type TrumpCard, type PartialGameState } from './trump-logic.js';
// @ts-ignore -- uno-logic.js はプレーンJS（型定義なし）
import { unoCanPlay } from './uno-logic.js';

// ----------------------------------------
// 型定義（このファイル内で完結させる最小限の型）
// ----------------------------------------

type UnoColor = 'red' | 'blue' | 'green' | 'yellow';
type UnoCardType = 'num' | 'skip' | 'rev' | 'd2' | 'w' | 'w4';

interface UnoCard {
  c: UnoColor | 'w';
  t: UnoCardType;
  v: string;
}

/** trump-logic.ts の TrumpGameState を、このファイルで実際に使うUNOフィールドまで拡張したもの */
interface FusionGameState extends PartialGameState {
  order: string[];
  ci: number;
  phase: 'trump' | 'uno';
  trumpField: TrumpCard[];
  hasParent?: string;
  unoHands: Record<string, UnoCard[]>;
  unoDiscardPile: UnoCard[];
  unoCurrentColor: UnoColor;
  unoPenaltyAccum?: number;
}

// window 拡張の型宣言（ビルド時にany扱いになるのを避けるため）
declare global {
  interface Window {
    _currentGame: FusionGameState | null;
    _currentTrumpHand: TrumpCard[];
    _roomState: string | null;
    toggleTestBot: () => void;
    toggleMonkeyPlay: () => void;
  }
}

const UNO_COLORS: UnoColor[] = ['red', 'blue', 'green', 'yellow'];

let botTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature = '';
let stuckCount = 0;

function log(...args: unknown[]): void {
  console.log('%c[TestBot]', 'color:#e67e22;font-weight:bold', ...args);
}

// ----------------------------------------
// トランプ：出せる最初の1枚（単騎）を探す
// ----------------------------------------
function findPlayableTrumpSingle(
  hand: TrumpCard[],
  fieldCards: TrumpCard[],
  g: FusionGameState
): TrumpCard | null {
  for (const card of hand) {
    if (trumpCanPlay([card], fieldCards, g)) return card;
  }
  return null;
}

// ----------------------------------------
// UNO：出せる最初の1枚を探す（インデックスを返す）
// ----------------------------------------
function findPlayableUnoIdx(
  hand: UnoCard[],
  top: UnoCard,
  currentColor: UnoColor,
  penaltyAccum: number
): number {
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    if (card && unoCanPlay(card, top, currentColor, penaltyAccum)) return i;
  }
  return -1;
}

// ----------------------------------------
// 手札の中で一番枚数が多い色を選ぶ（親の権限・ワイルド用）
// ----------------------------------------
function pickBestColor(hand: UnoCard[]): UnoColor {
  const counts: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
  hand.forEach(c => {
    if (c.c !== 'w' && counts[c.c] !== undefined) counts[c.c]++;
  });
  let best: UnoColor = UNO_COLORS[0]!;
  UNO_COLORS.forEach(c => { if (counts[c] > counts[best]) best = c; });
  return best;
}

// ----------------------------------------
// 1手番分の思考・実行
// ----------------------------------------
async function step(): Promise<void> {
  const g = window._currentGame;
  if (!g || window._roomState !== 'playing') return;

  const isMyTurn = g.order[g.ci] === state.myId;
  if (!isMyTurn) {
    lastSignature = '';
    stuckCount = 0;
    return;
  }

  const trumpHand: TrumpCard[] = window._currentTrumpHand || [];
  const unoHand: UnoCard[] = (g.unoHands && g.unoHands[state.myId]) || [];

  // ─── 進行不能（スタック）の自動検知 ───
  const signature = `${g.phase}-${g.ci}-${trumpHand.length}-${unoHand.length}-${g.unoPenaltyAccum || 0}`;
  if (signature === lastSignature) {
    stuckCount++;
    if (stuckCount >= 5) {
      log('進行不能（スタック）を検知したため自動停止しました', g);
      window.toggleTestBot();
      return;
    }
  } else {
    lastSignature = signature;
    stuckCount = 0;
  }

  // ─── トランプフェイズ ───
  if (g.phase === 'trump') {
    if (trumpHand.length === 0) {
      const res = await actionTrumpSkip();
      if (res?.error) log('❌ トランプスキップ失敗:', res.error); // ★エラーログ追加
      return;
    }
    const fieldCards: TrumpCard[] = Array.isArray(g.trumpField) ? g.trumpField : [];
    const playable = findPlayableTrumpSingle(trumpHand, fieldCards, g);
    if (playable) {
      log('トランプを出す →', playable.id);
      const res = await actionTrumpPlay([playable.id]);
      if (res?.error) log('❌ トランプ提出失敗:', res.error); // ★エラーログ追加
    } else {
      log('出せるトランプが無いためパス');
      const res = await actionTrumpPass();
      if (res?.error) log('❌ トランプパス失敗:', res.error); // ★エラーログ追加
    }
    return;
  }

  // ─── UNOフェイズ ───
  if (g.phase === 'uno') {
    if (g.hasParent === state.myId && unoHand.length > 0) {
      const color = pickBestColor(unoHand);
      log('親の権限で色を変更 →', color);
      const res = await actionPickParentColor(color);
      if (res?.error) log('❌ 親の色変更失敗:', res.error); // ★エラーログ追加
    }

    if (unoHand.length === 0) {
      const res = await actionUnoSkip();
      if (res?.error) log('❌ UNOスキップ失敗:', res.error); // ★エラーログ追加
      return;
    }

    const top = g.unoDiscardPile[g.unoDiscardPile.length - 1];
    if (!top) return;
    const idx = findPlayableUnoIdx(unoHand, top, g.unoCurrentColor, g.unoPenaltyAccum || 0);

    if (idx !== -1) {
      const card = unoHand[idx]!;
      const isWild = card.t === 'w' || card.t === 'w4';
      const color = isWild ? pickBestColor(unoHand.filter((_, i) => i !== idx)) : null;
      log('UNOを出す →', card, isWild ? `(色: ${color})` : '');
      const res = await actionUnoPlay(idx, color);
      if (res?.error) log('❌ UNO提出失敗:', res.error); // ★エラーログ追加
      if (unoHand.length === 2) {
        await actionSayUno(); 
      }
    } else {
      log('出せるUNOが無いため引く');
      const res = await actionUnoDraw();
      if (res?.error) log('❌ UNOドロー失敗:', res.error); // ★エラーログ追加
    }
    return;
  }
}

// ----------------------------------------
// ON/OFF切り替え（既存のボタン onclick="toggleMonkeyPlay()" からも
// そのまま呼べるよう、旧名にもエイリアスしておく）
// ----------------------------------------
window.toggleTestBot = (): void => {
  const btn = document.getElementById('monkey-toggle-btn');
  if (botTimer) {
    clearInterval(botTimer);
    botTimer = null;
    lastSignature = '';
    stuckCount = 0;
    if (btn) { btn.textContent = '🤖 自動ON'; btn.style.background = '#ff9800'; }
    log('停止しました');
    return;
  }
  if (btn) { btn.textContent = '🤖 自動OFF'; btn.style.background = '#e74c3c'; }
  log('開始しました（出せるカードがあれば必ず出す greedy AI）');
  botTimer = setInterval(step, 800);
};

window.toggleMonkeyPlay = window.toggleTestBot;