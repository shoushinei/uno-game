// ========================================
// PC向けゲーム画面（#s-game-pc）の描画エントリポイント
//
// 従来の renderGame（ui-render.ts）と同じく「room を受けて全再描画」する。
// 画面は index.html に静的に用意された4ゾーンへ流し込む:
//   #pcg-topbar … ステータスバー（手番・特殊ルール・回転方向・自動プレイ/退室）
//   #pcg-table  … テーブル（他プレイヤーの席＋中央の場）
//   #pcg-drawer … 引き出しパネル（ログ/ルール）
//   #pcg-own    … 自分のエリア（トランプ手札/UNO手札/操作バー）
// ========================================
import { state } from '../../state.js';
import type { Player } from '../../logic/types';
import { othersInTurnOrder, seatPositions } from './seat-layout.js';
import { renderSeatHtml } from './seat-render.js';
import { renderFieldHtml } from './field-render.js';

declare global {
  interface Window {
    /** 開発・動作確認用: コンソールから任意の room で PC UI を描画できる */
    _pcDebugRender: (room: any) => void;
  }
}

/** 最後に描画した room（クリック後の再描画などに使う） */
let lastRoom: any = null;

export function rerenderPc(): void {
  if (lastRoom) renderGamePC(lastRoom);
}

export function renderGamePC(room: any): void {
  lastRoom = room;
  const g = room.game;
  if (!g) return;

  const players: Player[] = room.players || [];
  const curId = g.order?.[g.ci];
  const isMyTurn = curId === state.myId;
  const phase = g.phase || 'trump';

  _renderTopbar(room, players, curId, isMyTurn, phase);
  _renderTable(room);
  _renderOwn(room);
}

// ----------------------------------------
// ステータスバー
// ----------------------------------------
function _renderTopbar(room: any, players: Player[], curId: string | undefined, isMyTurn: boolean, phase: string): void {
  const el = document.getElementById('pcg-topbar');
  if (!el) return;
  const g = room.game;

  const phaseLabel = phase === 'trump' ? '①🃏 トランプ' : '②🎴 UNO';
  const curName = players.find(p => p.id === curId)?.name ?? '?';
  const turnHtml = isMyTurn
    ? `<span class="pcg-turn pcg-turn-me">あなたのターン ${phaseLabel}</span>`
    : `<span class="pcg-turn">${curName} のターン ${phaseLabel}</span>`;

  const badges: string[] = [];
  if (g.trumpRevolution) badges.push('<span class="pcg-badge pcg-badge-rev">🌀 革命中</span>');
  if (g.trumpElevenBack) badges.push('<span class="pcg-badge pcg-badge-jback">🔄 Jバック</span>');
  if (Array.isArray(g.trumpSuitLock) && g.trumpSuitLock.length > 0) {
    badges.push(`<span class="pcg-badge pcg-badge-lock">⛓ ${g.trumpSuitLock.join('')}しばり</span>`);
  }

  const dirLabel = g.dir === 1 ? '⟳ 時計回り' : '⟲ 反時計回り';
  const isAutoOn = !!(room.autoPlayers && room.autoPlayers[state.myId]);

  el.innerHTML = `
    <span class="pcg-room">ルーム ${state.roomId || '----'}</span>
    ${turnHtml}
    ${badges.join('')}
    <span class="pcg-spacer"></span>
    <span class="pcg-dir">${dirLabel}</span>
    <button class="pcg-btn ${isAutoOn ? 'pcg-btn-auto-on' : ''}" onclick="toggleMonkeyPlay()">
      ${isAutoOn ? '🐒 自動プレイ中' : '🐒 自動プレイ'}
    </button>
    <button class="pcg-btn" onclick="leaveGame()">🚪 退室</button>
  `;
}

// ----------------------------------------
// テーブル（席＋場）
// ----------------------------------------
function _renderTable(room: any): void {
  const el = document.getElementById('pcg-table');
  if (!el) return;
  const g = room.game;
  const players: Player[] = room.players || [];
  const autoPlayers: Record<string, boolean> = room.autoPlayers || {};
  const curId = g.order?.[g.ci];

  // 自分以外を手番順（自分基準に回転）で上弧に配置する
  const others = othersInTurnOrder(
    Array.isArray(g.order) ? g.order : [],
    players.map(p => p.id),
    state.myId
  );
  const positions = seatPositions(others);
  const seatsHtml = positions
    .map(pos => renderSeatHtml(pos, { g, players, autoPlayers, curId }))
    .join('');

  el.innerHTML = `
    <div class="pcg-table-felt"></div>
    ${seatsHtml}
    ${renderFieldHtml(g, players)}
  `;
}

// ----------------------------------------
// 自分のエリア（手札＋操作バー） … Step3 で実装
// ----------------------------------------
function _renderOwn(room: any): void {
  const el = document.getElementById('pcg-own');
  if (!el) return;
  const g = room.game;
  const myTrump = (g.trumpHands && g.trumpHands[state.myId]) || [];
  const myUno = (g.unoHands && g.unoHands[state.myId]) || [];
  el.innerHTML = `
    <div class="pcg-placeholder">手札・操作バーは Step3 で実装（🃠${myTrump.length}枚・●${myUno.length}枚）</div>
  `;
}

// 開発・動作確認用フック
window._pcDebugRender = renderGamePC;
