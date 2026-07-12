// ========================================
// PC UI用のカードHTML生成ヘルパー
//
// 既存UIの .trump-hand-card / .hcd とはクラスを共有しない
// （既存CSSの変更が新UIに波及して事故るのを防ぐため、あえて独立させる）。
// ========================================
import type { TrumpCard } from '../../logic/trump-logic.js';
import type { UnoCard } from '../../logic/types';

/**
 * トランプ1枚のHTML。
 * @param extraClass 追加クラス（選択状態など）
 * @param attrs      追加属性（クリック用の data-* など）
 */
export function pcTrumpCardHtml(card: TrumpCard, extraClass = '', attrs = ''): string {
  const isJoker = card.v === 'JOKER';
  const isRed = card.s === '♥' || card.s === '♦';
  const cls = `pcg-tcard${isRed ? ' red' : ''}${isJoker ? ' joker' : ''}${extraClass ? ' ' + extraClass : ''}`;
  if (isJoker) {
    return `<div class="${cls}" ${attrs}><span class="pcg-tc-v">🃏</span></div>`;
  }
  return `<div class="${cls}" ${attrs}><span class="pcg-tc-s">${card.s}</span><span class="pcg-tc-v">${card.v}</span></div>`;
}

/** UNO1枚のHTML */
export function pcUnoCardHtml(card: UnoCard, extraClass = '', attrs = ''): string {
  const colorClass = (card.t === 'w' || card.t === 'w4') ? 'w' : card.c;
  const cls = `pcg-ucard pcg-uc-${colorClass}${extraClass ? ' ' + extraClass : ''}`;
  return `<div class="${cls}" ${attrs}>${card.v}</div>`;
}
