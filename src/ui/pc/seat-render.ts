// ========================================
// 席（他プレイヤー1人分）の描画
//
// 常時表示するのは「今の状態」だけ（名前・枚数・バッジ・手番フェイズチップ）。
// 「過去（直近の操作）」は hover カード（Step4）、対人リアクションは
// クリックメニュー（Phase C）に置く、という情報3階層ルールに従う。
// ========================================
import { AVATAR_COLORS } from '../../logic/game-init.js';
import type { Player } from '../../logic/types';
import type { SeatPosition } from './seat-layout.js';

export interface SeatContext {
  g: any;
  players: Player[];
  autoPlayers: Record<string, boolean>;
  curId: string | undefined;
}

export function renderSeatHtml(pos: SeatPosition, ctx: SeatContext): string {
  const { g, players, autoPlayers, curId } = ctx;
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
  const isAuto = !!autoPlayers[pos.id];

  const phase = g.phase || 'trump';
  const phaseChip = isCurrent
    ? `<span class="pcg-seat-phase">${phase === 'trump' ? '①🃏 トランプ中' : '②🎴 UNO中'}</span>`
    : '';

  const statusChips: string[] = [];
  if (finished) statusChips.push(`<span class="pcg-seat-chip pcg-chip-rank">🏁 ${rankIdx + 1}位</span>`);
  if (isAuto && !finished) statusChips.push('<span class="pcg-seat-chip pcg-chip-auto">🐒 自動プレイ中</span>');

  const countsHtml = finished
    ? '<span class="pcg-seat-counts">観戦中</span>'
    : `<span class="pcg-seat-counts">🂠${trumpCount}・<span class="pcg-uno-dot">●</span>${unoCount}${saidUno ? ' <span class="pcg-said-uno">📢UNO</span>' : ''}</span>`;

  return `
    <div class="pcg-seat${isCurrent ? ' current' : ''}${finished ? ' finished' : ''}"
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
    </div>
  `;
}
