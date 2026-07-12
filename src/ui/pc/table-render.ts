// ========================================
// PC向けゲーム画面（#s-game-pc）の描画エントリポイント
//
// 従来の renderGame（ui-render.ts）と同じく「room を受けて全再描画」する。
// 画面は index.html に静的に用意された4ゾーンへ流し込む:
//   #pcg-topbar … ステータスバー（手番・特殊ルール・回転方向・自動プレイ/退室）
//   #pcg-table  … テーブル（他プレイヤーの席＋中央の場）
//   #pcg-drawer … 引き出しパネル（ログ/ルール）
//   #pcg-own    … 自分のエリア（トランプ手札/UNO手札/操作バー）
//
// クリックは #s-game-pc 全体への1つのイベント委譲で処理する
// （全再描画してもリスナーが生き残るようにするため）。
// ボタン類は data-action 属性、手札カードは data-tcard-id / data-ucard-idx
// を持ち、実際の処理は app.ts が window に登録した既存ハンドラへ委譲する。
// ========================================
import { state } from '../../state.js';
import type { Player, UnoCard } from '../../logic/types';
import type { TrumpCard } from '../../logic/trump-logic.js';
import {
  getSelectedTrumpIds,
  getSelectedUnoIdx,
  getPendingUnoIdx,
  setPendingUnoIdx,
  clearPendingUnoIdx,
  resetTrumpSelection,
  resetUnoSelection,
  isTrumpCardVisiblySelected,
  isUnoCardVisiblySelected,
} from '../ui-input.js';
import { othersInTurnOrder, seatPositions } from './seat-layout.js';
import { renderSeatHtml } from './seat-render.js';
import { renderFieldHtml } from './field-render.js';
import { pcTrumpCardHtml, pcUnoCardHtml } from './cards.js';
import { deriveBarState, renderActionBarHtml } from './action-bar.js';
import {
  renderDrawerHtml,
  toggleDrawer,
  setDrawerTab,
  isDrawerOpen,
  mergeServerLog,
  resetDrawerLog,
} from './drawer.js';

declare global {
  interface Window {
    /** 開発・動作確認用: コンソールから任意の room で PC UI を描画できる */
    _pcDebugRender: (room: any) => void;
  }
}

/** 最後に描画した room（クリック後の再描画などに使う） */
let lastRoom: any = null;

/** ログ蓄積のリセット判定用（別ルームに入ったら蓄積を捨てる） */
let lastRoomIdForLog: string | null = null;

/** 操作バーの一時モード（色選択中）。前提が崩れたら描画時に自動クリアされる */
let barOverride: 'wild-color' | 'parent-color' | null = null;

/** 自己リアクションの絵文字ストリップが開いているか */
let reactionOpen = false;

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
  const iFinished = (g.rankings || []).some((r: { id: string }) => r.id === state.myId);

  // ★選択状態の自己修復★（従来UIの renderGame と同じ理由）
  // 自分が操作できないフェイズでは、古い選択状態を必ずリセットする。
  const canActTrump = isMyTurn && phase === 'trump' && !iFinished;
  const canActUno = isMyTurn && phase === 'uno' && !iFinished;
  if (!canActTrump) resetTrumpSelection();
  if (!canActUno) resetUnoSelection();

  // 別ルームに入ったらログの蓄積をリセットしてからマージする
  if (lastRoomIdForLog !== state.roomId) {
    resetDrawerLog();
    lastRoomIdForLog = state.roomId;
  }
  mergeServerLog(room.log);

  _renderTopbar(room, players, curId, isMyTurn, phase);
  _renderTable(room);
  _renderDrawer(room);
  _renderOwn(room, canActTrump, canActUno, iFinished);
}

// ----------------------------------------
// 引き出しパネル（ログ/ルール）
// ----------------------------------------
function _renderDrawer(room: any): void {
  const el = document.getElementById('pcg-drawer');
  if (!el) return;
  el.classList.toggle('open', isDrawerOpen());
  el.innerHTML = renderDrawerHtml(room.game);
  // ログは常に最新（末尾）までスクロールしておく
  const list = document.getElementById('pcg-log-list');
  if (list) list.scrollTop = list.scrollHeight;
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
    .map(pos => renderSeatHtml(pos, { g, players, autoPlayers, curId, actionLog: room.actionLog }))
    .join('');

  el.innerHTML = `
    <div class="pcg-table-felt"></div>
    ${seatsHtml}
    ${renderFieldHtml(g, players)}
  `;
}

// ----------------------------------------
// 自分のエリア（手札＋操作バー）
// ----------------------------------------
function _renderOwn(room: any, canActTrump: boolean, canActUno: boolean, iFinished: boolean): void {
  const el = document.getElementById('pcg-own');
  if (!el) return;
  const g = room.game;
  const players: Player[] = room.players || [];

  const bar = deriveBarState(g, state.myId, {
    selectedTrumpIds: getSelectedTrumpIds(),
    selectedUnoIdx: getSelectedUnoIdx(),
    pendingUnoIdx: getPendingUnoIdx(),
    override: barOverride,
  }, players);

  // 一時モードの前提が崩れていたら（手番が移った等）保持している状態も掃除する
  if (barOverride && bar.mode !== barOverride) barOverride = null;

  el.innerHTML = `
    ${_handRowsHtml(g, canActTrump, canActUno, iFinished)}
    ${renderActionBarHtml(bar, reactionOpen)}
  `;
}

function _handRowsHtml(g: any, canActTrump: boolean, canActUno: boolean, iFinished: boolean): string {
  if (iFinished) {
    return '<div class="pcg-hand-done">🏁 上がり（観戦中）— 最後までゆっくり見ていってください</div>';
  }

  const myTrump: TrumpCard[] = (g.trumpHands && g.trumpHands[state.myId]) || [];
  const myUno: UnoCard[] = (g.unoHands && g.unoHands[state.myId]) || [];
  const phase = g.phase || 'trump';

  // ---- ①トランプ手札 ----
  const selectedIds = getSelectedTrumpIds();
  const trumpField = Array.isArray(g.trumpField) ? g.trumpField : [];
  const trumpCards = myTrump.length === 0
    ? '<span class="pcg-hand-empty">✅ 出し切り</span>'
    : myTrump.map(card => {
        const canPlay = canActTrump && window.trumpCanPlayCard(card, trumpField, selectedIds);
        const isSelected = isTrumpCardVisiblySelected(card.id, selectedIds, canActTrump);
        const cls = `pcg-hand-card${!canPlay && !isSelected ? ' off' : ''}${isSelected ? ' selected' : ''}`;
        const attrs = (canPlay || isSelected) ? `data-tcard-id="${card.id}"` : '';
        return pcTrumpCardHtml(card, cls, attrs);
      }).join('');

  // ---- ②UNO手札 ----
  const selectedIdx = getSelectedUnoIdx();
  const topUno = Array.isArray(g.unoDiscardPile) && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1]
    : null;
  const unoCards = myUno.length === 0
    ? '<span class="pcg-hand-empty">✅ 出し切り</span>'
    : myUno.map((card, idx) => {
        const canPlay = canActUno && topUno
          ? window.unoCanPlayCard(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum)
          : false;
        const isSelected = isUnoCardVisiblySelected(idx, selectedIdx, canActUno);
        const cls = `pcg-hand-card${!canPlay && !isSelected ? ' off' : ''}${isSelected ? ' selected' : ''}`;
        const attrs = (canPlay || isSelected) ? `data-ucard-idx="${idx}"` : '';
        return pcUnoCardHtml(card, cls, attrs);
      }).join('');

  return `
    <div class="pcg-hand-row${phase === 'trump' ? ' active' : ''}">
      <span class="pcg-hand-label">①🃏 手札 ${myTrump.length}</span>
      <div class="pcg-hand-cards">${trumpCards}</div>
    </div>
    <div class="pcg-hand-row${phase === 'uno' ? ' active' : ''}">
      <span class="pcg-hand-label">②🎴 手札 ${myUno.length}</span>
      <div class="pcg-hand-cards">${unoCards}</div>
    </div>
  `;
}

// ----------------------------------------
// イベント委譲（モジュール読み込み時に1回だけバインドする）
// ----------------------------------------
async function _handleAction(action: string, target: HTMLElement): Promise<void> {
  switch (action) {
    case 'trump-play':
      await window.submitTrumpPlay();
      break;
    case 'trump-pass':
      await window.trumpPass();
      break;
    case 'trump-skip':
      await window.trumpSkip();
      break;
    case 'uno-play': {
      const idx = getSelectedUnoIdx();
      if (idx === null) return;
      const g = lastRoom?.game;
      const card = g?.unoHands?.[state.myId]?.[idx];
      if (card && (card.t === 'w' || card.t === 'w4')) {
        // ワイルド系: バーを色選択モードへ（従来のモーダルは使わない）
        setPendingUnoIdx(idx);
        resetUnoSelection();
        barOverride = 'wild-color';
      } else {
        await window.submitUnoPlay();
      }
      break;
    }
    case 'wild-color':
      barOverride = null;
      await window.pickColor(target.dataset.color!);
      break;
    case 'wild-cancel':
      clearPendingUnoIdx();
      barOverride = null;
      break;
    case 'uno-draw':
      await window.unoDraw();
      break;
    case 'uno-skip':
      await window.unoSkip();
      break;
    case 'say-uno':
      await window.sayUno();
      break;
    case 'parent-open':
      barOverride = 'parent-color';
      break;
    case 'parent-color':
      barOverride = null;
      await window.pickParentColor(target.dataset.color!);
      break;
    case 'parent-cancel':
      barOverride = null;
      break;
    case 'reaction-toggle':
      reactionOpen = !reactionOpen;
      break;
    case 'reaction':
      reactionOpen = false;
      await window.sendReaction(target.dataset.emoji!);
      break;
    case 'drawer-toggle':
      toggleDrawer();
      break;
    case 'drawer-tab':
      setDrawerTab(target.dataset.tab!);
      break;
  }
  rerenderPc();
}

function _onPcClick(e: MouseEvent): void {
  const target = (e.target as HTMLElement).closest<HTMLElement>(
    '[data-action], [data-tcard-id], [data-ucard-idx]'
  );
  if (!target) return;

  if (target.dataset.tcardId) {
    window.selectTrumpCard(target.dataset.tcardId);
    rerenderPc();
    return;
  }
  if (target.dataset.ucardIdx !== undefined) {
    window.selectUnoCard(parseInt(target.dataset.ucardIdx, 10));
    rerenderPc();
    return;
  }
  if (target.dataset.action) {
    void _handleAction(target.dataset.action, target);
  }
}

document.getElementById('s-game-pc')?.addEventListener('click', _onPcClick);

// 開発・動作確認用フック
window._pcDebugRender = renderGamePC;
