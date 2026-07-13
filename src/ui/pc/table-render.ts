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
import { maybeAutoAdvance } from './auto-advance.js';
import { countUnoActivePlayers } from '../../logic/uno-logic.js';

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

/**
 * 演出検知用: 前回同期時点の actionLog 長。
 * 新しく増えたエントリだけを見て演出を再生する（actionLog駆動の演出基盤）。
 * -1 は「このルームでまだ一度も同期していない」印で、初回は演出を再生しない
 * （途中参加・リロード時に過去の操作の演出が一気に再生されるのを防ぐ）。
 */
let seenActionLogLen = -1;

/**
 * ゾーンごとの前回HTMLキャッシュ（差分描画用）。
 *
 * ★クリック不能バグの修正★
 * Firebase同期のたびに全ゾーンを innerHTML で作り直すと、bot対戦中
 * （毎秒更新）はボタンが mousedown と mouseup の間に破壊されて
 * クリックが成立しない。「HTMLが前回と同じならDOMに触らない」ことで、
 * 変化のないゾーン（大抵はステータスバーや操作バー）のボタンを保護する。
 */
const zoneCache: Record<string, string> = {};

function setZone(id: string, html: string): boolean {
  if (zoneCache[id] === html) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  el.innerHTML = html;
  zoneCache[id] = html;
  return true;
}

/** 操作バーの一時モード（色選択中）。前提が崩れたら描画時に自動クリアされる */
let barOverride: 'wild-color' | 'parent-color' | null = null;

/** 自己リアクションの絵文字ストリップが開いているか */
let reactionOpen = false;

export function rerenderPc(): void {
  if (lastRoom) renderGamePC(lastRoom);
}

export function renderGamePC(room: any): void {
  // ★重要★ この関数は Firebase リスナーのコールバックから呼ばれる。
  // 描画中の例外がリスナーまで波及すると、そのクライアントだけ同期が
  // 止まり「1人だけ古いターン表示のまま固まる」事故になるため、
  // 例外は必ずここで握りつぶしてログに出す。
  try {
    _renderGamePCInner(room);
  } catch (e) {
    console.error('renderGamePC で描画エラー（同期は継続します）:', e);
  }
}

function _renderGamePCInner(room: any): void {
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

  // 別ルームに入ったらログの蓄積・演出の既読位置をリセットする
  if (lastRoomIdForLog !== state.roomId) {
    resetDrawerLog();
    lastRoomIdForLog = state.roomId;
    seenActionLogLen = -1;
  }
  mergeServerLog(room.log);
  _detectEffects(room, players);

  _renderTopbar(room, players, curId, isMyTurn, phase);
  _renderTable(room);
  _renderDrawer(room);
  _renderOwn(room, canActTrump, canActUno, iFinished);
}

// ----------------------------------------
// 演出（actionLog駆動）
//
// 同期のたびに「前回から増えた actionLog エントリ」を調べて演出を再生する。
// 全クライアントが同じ actionLog を受け取るため、演出も全員の画面で同期する。
// 現在は親の権限発動のみ。今後のPhase B（カード移動等）もこの仕組みに乗せる。
// ----------------------------------------
const EFFECT_COLOR_LABELS: Record<string, { label: string; hex: string }> = {
  red:    { label: '赤', hex: '#d64541' },
  blue:   { label: '青', hex: '#2e86de' },
  green:  { label: '緑', hex: '#27ae60' },
  yellow: { label: '黄', hex: '#e5b800' },
};

function _detectEffects(room: any, players: Player[]): void {
  const log: any[] = Array.isArray(room.actionLog) ? room.actionLog : [];
  if (seenActionLogLen === -1) {
    // 初回同期（入室直後・リロード直後）は過去分の演出を再生しない
    seenActionLogLen = log.length;
    return;
  }
  if (log.length <= seenActionLogLen) {
    // ロビーに戻る等でログが短くなった場合は位置を合わせ直すだけ
    seenActionLogLen = log.length;
    return;
  }
  const fresh = log.slice(seenActionLogLen);
  seenActionLogLen = log.length;

  for (const entry of fresh) {
    if (entry?.type === 'pickParentColor') {
      const name = players.find(p => p.id === entry.playerId)?.name ?? '?';
      const color = entry.args?.color ?? '';
      _showParentEffect(name, color);
    }
  }
}

/** 親の権限発動の演出（画面中央に王冠＋色をポップ表示） */
function _showParentEffect(playerName: string, color: string): void {
  const layer = document.getElementById('pcg-effect-layer');
  if (!layer) return;
  const c = EFFECT_COLOR_LABELS[color] ?? { label: color, hex: '#fff' };
  const el = document.createElement('div');
  el.className = 'pcg-effect-parent';
  el.innerHTML = `
    <div class="pcg-ep-crown">👑</div>
    <div class="pcg-ep-title">親の権限発動！</div>
    <div class="pcg-ep-sub">${playerName} が色を
      <span class="pcg-ep-color" style="background:${c.hex}"></span><b>${c.label}</b> に変更
    </div>
  `;
  layer.appendChild(el);
  // アニメーション（2.4s）終了後に取り除く
  setTimeout(() => el.remove(), 2500);
}

// ----------------------------------------
// 引き出しパネル（ログ/ルール）
// ----------------------------------------
function _renderDrawer(room: any): void {
  const el = document.getElementById('pcg-drawer');
  if (!el) return;
  el.classList.toggle('open', isDrawerOpen());
  const changed = setZone('pcg-drawer', renderDrawerHtml(room.game));
  // 内容が更新されたときだけ、ログを最新（末尾）までスクロールする
  if (changed) {
    const list = document.getElementById('pcg-log-list');
    if (list) list.scrollTop = list.scrollHeight;
  }
}

// ----------------------------------------
// ステータスバー
// ----------------------------------------
function _renderTopbar(room: any, players: Player[], curId: string | undefined, isMyTurn: boolean, phase: string): void {
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
  // ★ルール追加（UNO残り1人）★ +2/+4のドロー効果が無効になっている状態を明示
  if (countUnoActivePlayers(g) === 1) {
    badges.push('<span class="pcg-badge pcg-badge-solo">🎴 UNO残り1人（+2/+4無効）</span>');
  }

  const dirLabel = g.dir === 1 ? '⟳ 時計回り' : '⟲ 反時計回り';

  // 情報部だけを再描画する（右端の操作ボタンは index.html の静的DOM）
  setZone('pcg-topbar-info', `
    <span class="pcg-room">ルーム ${state.roomId || '----'}</span>
    ${turnHtml}
    ${badges.join('')}
    <span class="pcg-spacer"></span>
    <span class="pcg-dir">${dirLabel}</span>
  `);

  // ★クリック不能バグの修正★ 自動プレイボタンは innerHTML で作り直さず、
  // 静的DOMのラベル・クラスだけを差分更新する（クリック中に破壊されないように）
  const isAutoOn = !!(room.autoPlayers && room.autoPlayers[state.myId]);
  const autoBtn = document.getElementById('pcg-auto-btn');
  if (autoBtn) {
    const label = isAutoOn ? '🐒 自動プレイ中' : '🐒 自動プレイ';
    if (autoBtn.textContent !== label) autoBtn.textContent = label;
    autoBtn.classList.toggle('pcg-btn-auto-on', isAutoOn);
  }
}

// ----------------------------------------
// テーブル（席＋場）
// ----------------------------------------
function _renderTable(room: any): void {
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

  setZone('pcg-table', `
    <div class="pcg-table-felt"></div>
    ${seatsHtml}
    ${renderFieldHtml(g, players)}
  `);
}

// ----------------------------------------
// 自分のエリア（手札＋操作バー）
// ----------------------------------------
function _renderOwn(room: any, canActTrump: boolean, canActUno: boolean, iFinished: boolean): void {
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

  // フェイズ自動進行（手札0枚のスキップを自動発火）。
  // 予約中はバーに「自動で進みます…」を表示し、発火が滞ったときだけ
  // 手動スキップボタンにフォールバックする
  const autoAdvancing = maybeAutoAdvance(room, rerenderPc);

  setZone('pcg-own', `
    ${_handRowsHtml(g, canActTrump, canActUno, iFinished)}
    ${renderActionBarHtml(bar, reactionOpen, autoAdvancing)}
  `);
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
