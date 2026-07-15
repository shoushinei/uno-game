// ========================================
// 席（他プレイヤー1人分）の描画
//
// 常時表示するのは「今の状態」だけ（名前・枚数・バッジ・手番フェイズチップ）。
// 「過去（直近の操作）」はホバーカードに載せる（情報3階層ルール）。
//
// ホバーカードはJSの状態を持たず、席のHTML内に非表示で埋め込んで
// CSSの :hover で出す（全再描画が走っても壊れない・遅延なしで即表示）。
// 配置は「場（テーブル中央）を遮らない」よう、左半分の席は右外側へ、
// 右半分の席は左外側へ出す。
// ========================================
import { AVATAR_COLORS } from '../../logic/game-init.js';
import type { Player } from '../../logic/types';
import type { SeatPosition } from './seat-layout.js';
import { lastActionsOf, summarizeTrumpEntry, summarizeUnoEntry } from './last-actions.js';
import { pcTrumpCardHtml, pcUnoCardHtml } from './cards.js';
import type { ReplayActionLogEntry } from '../../replay/types';

export interface SeatContext {
  g: any;
  players: Player[];
  autoPlayers: Record<string, boolean>;
  leftPlayers: Record<string, boolean>;
  curId: string | undefined;
  actionLog: ReplayActionLogEntry[] | null | undefined;
}

export function renderSeatHtml(pos: SeatPosition, ctx: SeatContext): string {
  const { g, players, autoPlayers, leftPlayers, curId } = ctx;
  const player = players.find(p => p.id === pos.id);
  const name = player ? player.name : '?';
  const playerIdx = players.findIndex(p => p.id === pos.id);
  const avatarColor = AVATAR_COLORS[Math.max(0, playerIdx) % 5];

  const trumpCount = (g.trumpHands && g.trumpHands[pos.id]) ? g.trumpHands[pos.id].length : 0;
  const unoCount = (g.unoHands && g.unoHands[pos.id]) ? g.unoHands[pos.id].length : 0;

  const rankIdx = (g.rankings || []).findIndex((r: { id: string }) => r.id === pos.id);
  const finished = rankIdx !== -1;
  const isCurrent = pos.id === curId && !finished;
  const isParent = g.hasParent === pos.id;
  const saidUno = !!(g.unoSaid && g.unoSaid[pos.id]);
  const isLeft = !!leftPlayers[pos.id];
  const isAuto = !!autoPlayers[pos.id];

  const phase = g.phase || 'trump';
  const phaseChip = isCurrent
    ? `<span class="pcg-seat-phase">${phase === 'trump' ? '①🃏 トランプ中' : '②🎴 UNO中'}</span>`
    : '';

  const statusChips: string[] = [];
  if (finished) statusChips.push(`<span class="pcg-seat-chip pcg-chip-rank">🏁 ${rankIdx + 1}位</span>`);
  // 退室中（灰）と自発的な自動プレイ（紫）は区別する。退室中を優先表示
  else if (isLeft) statusChips.push('<span class="pcg-seat-chip pcg-chip-left">🚪 退室中（自動）</span>');
  else if (isAuto) statusChips.push('<span class="pcg-seat-chip pcg-chip-auto">🐒 自動プレイ中</span>');

  const countsHtml = finished
    ? '<span class="pcg-seat-counts">観戦中</span>'
    : `<span class="pcg-seat-counts">🂠${trumpCount}・<span class="pcg-uno-dot">●</span>${unoCount}${saidUno ? ' <span class="pcg-said-uno">📢UNO</span>' : ''}</span>`;

  // ホバーカードの向き: 左半分の席は右外側、右半分の席は左外側
  const hoverSide = pos.xPercent < 50 ? 'hover-r' : 'hover-l';

  return `
    <div class="pcg-seat ${hoverSide}${isCurrent ? ' current' : ''}${finished ? ' finished' : ''}"
         data-seat-id="${pos.id}"
         style="left:${pos.xPercent}%;top:${pos.yPercent}%">
      <div class="pcg-avatar" style="background:${avatarColor}">
        ${name.slice(0, 1).toUpperCase()}
        ${isParent ? '<span class="pcg-crown">👑</span>' : ''}
      </div>
      <div class="pcg-seat-name">${name}</div>
      ${countsHtml}
      ${phaseChip}
      ${statusChips.join('')}
      ${_hoverCardHtml(name, pos.id, ctx.actionLog)}
    </div>
  `;
}

// ----------------------------------------
// ホバーカード（直近の操作）
// ----------------------------------------
function _hoverCardHtml(name: string, playerId: string, actionLog: ReplayActionLogEntry[] | null | undefined): string {
  const last = lastActionsOf(actionLog, playerId);

  let trumpRow: string;
  if (last.trump) {
    const s = summarizeTrumpEntry(last.trump);
    const cards = s.cards.map(c => pcTrumpCardHtml(c, 'mini')).join('');
    trumpRow = `${cards}<span>${s.text}</span>`;
  } else {
    trumpRow = '<span class="pcg-hc-none">まだ操作なし</span>';
  }

  let unoRow: string;
  if (last.uno) {
    const s = summarizeUnoEntry(last.uno);
    const card = s.card ? pcUnoCardHtml(s.card as any, 'mini') : '';
    unoRow = `${card}<span>${s.text}</span>`;
  } else {
    unoRow = '<span class="pcg-hc-none">まだ操作なし</span>';
  }

  return `
    <div class="pcg-hovercard">
      <div class="pcg-hc-title">${name} の直近の操作</div>
      <div class="pcg-hc-row"><span class="pcg-hc-ph">①🃏</span>${trumpRow}</div>
      <div class="pcg-hc-row"><span class="pcg-hc-ph">②🎴</span>${unoRow}</div>
    </div>
  `;
}
