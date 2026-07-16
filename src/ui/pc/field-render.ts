// ========================================
// テーブル中央の場の描画
//
// 空間原則「トランプ＝上、UNO＝下」に従い、上段に①🃏の場、下段に②🎴の場を
// 縦に積む。現在のフェイズ側のゾーンをハイライトし、もう片方は薄く表示する
// （＝「今どちらの盤面が動いているか」を色と明度で示す）。
// ========================================
import { pcTrumpCardHtml, pcUnoCardHtml } from './cards.js';
import type { Player } from '../../logic/types';

const COLOR_LABELS: Record<string, string> = {
  red: '🔴 赤', blue: '🔵 青', green: '🟢 緑', yellow: '🟡 黄',
};

export function renderFieldHtml(g: any, players: Player[]): string {
  const phase = g.phase || 'trump';

  // ---- ①トランプの場 ----
  const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
  const ownerName = g.trumpFieldOwner
    ? (players.find(p => p.id === g.trumpFieldOwner)?.name ?? '?')
    : null;
  const trumpCardsHtml = fCards.length > 0
    ? fCards.map((c: any) => pcTrumpCardHtml(c)).join('')
    : '<div class="pcg-field-empty">場は空<br><small>何でも出せる</small></div>';
  const trumpMeta = fCards.length > 0
    ? `<span class="pcg-field-meta">${fCards.length}枚${ownerName ? '・' + ownerName : ''}</span>`
    : '';

  // ---- ②UNOの場 ----
  const topUno = Array.isArray(g.unoDiscardPile) && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1]
    : null;
  const unoCardHtml = topUno ? pcUnoCardHtml(topUno) : '<div class="pcg-field-empty">なし</div>';
  const colorLabel = COLOR_LABELS[g.unoCurrentColor] ?? g.unoCurrentColor ?? '-';
  const penalty = g.unoPenaltyAccum > 0
    ? `<span class="pcg-penalty">+${g.unoPenaltyAccum} 累積中！</span>`
    : '';

  // 回転方向（記号だけ）。トランプ／UNOの場の上に置いて分かりやすくする
  const isCW = g.dir === 1;
  const dirHtml = `<div class="pcg-field-dir${isCW ? '' : ' ccw'}" title="${isCW ? '時計回り' : '反時計回り'}">${isCW ? '⟳' : '⟲'}</div>`;

  return `
    <div class="pcg-field">
      ${dirHtml}
      <div class="pcg-field-zone pcg-field-trump${phase === 'trump' ? ' active' : ''}">
        <span class="pcg-field-label">①🃏 場</span>
        <div class="pcg-field-cards">${trumpCardsHtml}</div>
        ${trumpMeta}
      </div>
      <div class="pcg-field-zone pcg-field-uno${phase === 'uno' ? ' active' : ''}">
        <span class="pcg-field-label">②🎴 UNO</span>
        <div class="pcg-field-cards">${unoCardHtml}</div>
        <span class="pcg-field-meta">${colorLabel}</span>
        <div class="pcg-deck" title="山札">${penalty}</div>
      </div>
    </div>
  `;
}
