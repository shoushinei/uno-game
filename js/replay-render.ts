// ========================================
// リプレイ画面の描画
//
// 既存の renderGame（ui-render.js）は「自分の手札だけ表示・他人は枚数のみ」
// という“1人視点”を前提にDOM構造（#my-trump-hand 等のID）が
// 組まれているため、そのまま流用すると「全員の手札を同時に見せる」
// というリプレイの要件とは噛み合わない。
//
// そのため、カードの見た目（CSSクラス：trump-hand-card / hcd など）だけ
// 既存のものを再利用しつつ、レイアウト自体はリプレイ専用に
// 軽量な描画関数として書いている。
// ========================================
import type { ReplayEngine } from './replay-engine';

/** トランプ1枚分のカードHTMLを組み立てる（既存の .trump-hand-card クラスを再利用） */
function trumpCardHtml(card: { s: string; v: string }): string {
  const isRed = card.s === '♥' || card.s === '♦';
  return `<div class="trump-hand-card${isRed ? ' red' : ''}" style="cursor:default">` +
    `<span class="ts">${card.s}</span><span class="tv">${card.v}</span></div>`;
}

/** UNO1枚分のカードHTMLを組み立てる（既存の .hcd クラスを再利用） */
function unoCardHtml(card: { c: string; t: string; v: string }): string {
  const colorClass = (card.t === 'w' || card.t === 'w4') ? 'w' : card.c[0];
  return `<div class="hcd ${colorClass}" style="cursor:default">${card.v}</div>`;
}

/**
 * 現在のリプレイ再生位置（engine.currentGame）を #replay-view に描画する。
 * クリックなどの操作は一切受け付けない「見るだけ」の表示。
 */
export function renderReplayView(engine: ReplayEngine): void {
  const el = document.getElementById('replay-view');
  if (!el) return;
  const g = engine.currentGame as any;
  const players = engine.getPlayers();
  if (!g) { el.innerHTML = ''; return; }

  const curId = Array.isArray(g.order) && g.order.length > 0 ? g.order[g.ci] : null;
  const fieldTrump = Array.isArray(g.trumpField) ? g.trumpField : [];
  const topUno = Array.isArray(g.unoDiscardPile) && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1] : null;

  // ---- 場（トランプ・UNO）の表示 ----
  const parentName = g.hasParent ? (players.find((p: any) => p.id === g.hasParent)?.name ?? '?') : null;
  const fieldHtml = `
    <div class="field-row">
      <div class="field-box">
        <p class="field-label">🃏 トランプの場${parentName ? `（👑 親: ${parentName}）` : ''}</p>
        <div class="trump-field">
          ${fieldTrump.length > 0 ? fieldTrump.map(trumpCardHtml).join('') : '<div class="trump-empty">場は空</div>'}
        </div>
      </div>
      <div class="field-box">
        <p class="field-label">🎴 UNOの場（色: ${g.unoCurrentColor ?? '-'}）</p>
        ${topUno ? unoCardHtml(topUno) : '<div class="trump-empty">なし</div>'}
      </div>
    </div>
  `;

  // ---- 各プレイヤーの手札（全員分を表示する＝リプレイならではの部分） ----
  const rankingIds: string[] = (g.rankings || []).map((r: { id: string }) => r.id);
  const playersHtml = players.map((p) => {
    const trumpHand = (g.trumpHands && g.trumpHands[p.id]) || [];
    const unoHand = (g.unoHands && g.unoHands[p.id]) || [];
    const isCur = p.id === curId;
    const rankIdx = rankingIds.indexOf(p.id);
    return `
      <div class="hand-section" style="margin-top:8px;${isCur ? 'border-color:#e74c3c;border-width:1.5px' : ''}">
        <div class="hand-section-title">
          ${isCur ? '👉 ' : ''}${p.name}${rankIdx !== -1 ? `（🏁${rankIdx + 1}位）` : ''}
          （🃏${trumpHand.length}枚 / 🎴${unoHand.length}枚）
        </div>
        <div class="trump-hand">${trumpHand.map(trumpCardHtml).join('')}</div>
        <div class="hc">${unoHand.map(unoCardHtml).join('')}</div>
      </div>
    `;
  }).join('');

  // ---- 直近のゲームログ ----
  const logHtml = `<div class="glog">${
    (engine.currentLog || []).map(l => `<div class="log-entry">${l}</div>`).join('')
  }</div>`;

  el.innerHTML = fieldHtml + logHtml + playersHtml;
}
