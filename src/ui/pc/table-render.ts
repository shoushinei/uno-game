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
import { AVATAR_COLORS } from '../../logic/game-init.js';
import { renderSeatHtml } from './seat-render.js';
import { renderFieldHtml } from './field-render.js';
import { pcTrumpCardHtml, pcUnoCardHtml } from './cards.js';
import { deriveBarState, renderActionBarHtml } from './action-bar.js';
import {
  renderDrawerHtml,
  toggleDrawer,
  openDrawer,
  setDrawerTab,
  isDrawerOpen,
  mergeServerLog,
  resetDrawerLog,
} from './drawer.js';
import { maybeAutoAdvance } from './auto-advance.js';
import { countUnoActivePlayers } from '../../logic/uno-logic.js';
import {
  deriveFromEntries,
  deriveFromDiff,
  deriveTrumpSpecial,
  takeSnapshot,
  type GameSnap,
  type EffectDescriptor,
} from './effects/effect-derive.js';
import { enqueueEffects, clearEffectQueue } from './effects/effect-queue.js';
import { playEffect, flashTurnArrival, flashMyTurn, playReaction, playDirectedReaction, playHitToast, flashDirChange } from './effects/effect-render.js';
import {
  renderReactionMenuHtml,
  isReactorBlocked,
  toggleReactorBlock,
  areReactionsOff,
  toggleReactionsOff,
  DIRECTED_COOLDOWN_MS,
} from './reaction-menu.js';
import { canChallenge } from '../../logic/duel-logic.js';

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
 * 同一ルーム内での再戦検知用: 前回同期時点の actionLog 長・rankings 数。
 * これらが「減った」＝ロビー経由で新しいゲームが始まった印なので、
 * ドロワーのログ蓄積を捨てて前ゲームのログを引き継がないようにする。
 * （_runEffects の再戦検知と同じ信号。あちらはmergeServerLogの後に走るため、
 *   ログのリセットはマージ前のこちらで別途行う必要がある）
 */
let prevActionLogLenForLog = 0;
let prevRankingLenForLog = 0;

/**
 * 演出検知用: 前回同期時点のゲーム状態スナップショット。
 * null は「このルームでまだ一度も同期していない」印で、初回は
 * actionLog増分・状態diffとも演出を再生しない
 * （途中参加・リロード時に過去の演出が一気に再生されるのを防ぐ。
 *   例外はゲーム開始演出で、actionLogが空＝まだ誰も操作していない場合のみ再生）。
 */
let prevSnap: GameSnap | null = null;

/** trumpEffect（8切り・革命等）の再生済み ts。null=未初期化 */
let seenTrumpEffectTs: number | null = null;

/** 手番着弾フラッシュ用: 前回の手番プレイヤー */
let prevTurnId: string | null = null;

/** 回転方向フラッシュ用: 前回の g.dir。null=未初期化（初回は演出しない） */
let prevDir: number | null = null;

/**
 * リアクション表示用: プレイヤーごとの最後に再生した ts。
 * null=このルームで未初期化（初回同期では過去のリアクションを再生しない）。
 */
let prevReactionTs: Record<string, number> | null = null;

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

/**
 * 対人リアクションのクールダウン期限（Date.now() ミリ秒）。
 * 全宛先で共有する単一クールダウン（連投抑制）。0=クールダウンなし。
 */
let directedCooldownUntil = 0;
/** 現在開いている対人リアクションメニューの宛先ID（null=閉じている） */
let openMenuTargetId: string | null = null;

function isDirectedOnCooldown(): boolean {
  return Date.now() < directedCooldownUntil;
}

/**
 * 席の対人リアクションメニューを開く。
 *
 * 既定は席の真上（吹き出しが下向き）だが、縦の短い画面では上部の席で
 * 上に十分な余白が無く画面外にはみ出すため、上に置ける高さが無ければ
 * 席の下（吹き出しが上向き）に切り替える。横方向もフレーム幅内に収める。
 */
function openReactionMenu(seatEl: HTMLElement, targetId: string): void {
  const menu = document.getElementById('pcg-reaction-menu');
  const frame = document.querySelector<HTMLElement>('.pcg-frame');
  if (!menu || !frame) return;
  const name = lastRoom?.players?.find((p: Player) => p.id === targetId)?.name ?? '?';
  menu.innerHTML = renderReactionMenuHtml(
    targetId,
    name,
    isReactorBlocked(targetId),
    isDirectedOnCooldown(),
    // ★ヨットモード Step 2★ 挑戦できる相手にだけ「⚔挑む」を出す
    canChallenge(lastRoom, state.myId, targetId).ok
  );

  const sr = seatEl.getBoundingClientRect();
  const fr = frame.getBoundingClientRect();

  // 実際のメニュー高さ・幅を測るため、位置決め前に一旦表示する
  // （offsetHeight/Width はレイアウト寸法なので transform の影響を受けない）
  menu.classList.add('show');
  const menuH = menu.offsetHeight;
  const menuW = menu.offsetWidth;
  const margin = 8;

  const spaceAbove = sr.top - fr.top;
  const below = spaceAbove < menuH + margin;
  menu.classList.toggle('below', below);
  menu.style.top = below ? `${sr.bottom - fr.top}px` : `${sr.top - fr.top}px`;

  const centerX = sr.left + sr.width / 2 - fr.left;
  const clampedX = Math.min(Math.max(centerX, menuW / 2 + margin), fr.width - menuW / 2 - margin);
  menu.style.left = `${clampedX}px`;

  openMenuTargetId = targetId;
}

function closeReactionMenu(): void {
  const menu = document.getElementById('pcg-reaction-menu');
  if (menu) {
    menu.classList.remove('show');
    menu.innerHTML = '';
  }
  openMenuTargetId = null;
}

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
    prevSnap = null;
    seenTrumpEffectTs = null;
    prevTurnId = null;
    prevDir = null;
    prevReactionTs = null;
    prevActionLogLenForLog = 0;
    prevRankingLenForLog = 0;
    clearEffectQueue();
  }

  // ★同一ルーム再戦のログ引き継ぎ修正★
  // 同じルームで再戦すると roomId は変わらないため上のリセットは走らない。
  // actionLog または rankings が「減った」＝ロビー経由で新ゲームが始まったと
  // みなし、ドロワーのログ蓄積を捨てる（＝マージ前に空にする）。ゲーム中は
  // どちらも増える一方なので、進行中に誤ってクリアされることはない。
  const curActionLogLen = Array.isArray(room.actionLog) ? room.actionLog.length : 0;
  const curRankingLen = Array.isArray(g.rankings) ? g.rankings.length : 0;
  if (curActionLogLen < prevActionLogLenForLog || curRankingLen < prevRankingLenForLog) {
    resetDrawerLog();
  }
  prevActionLogLenForLog = curActionLogLen;
  prevRankingLenForLog = curRankingLen;

  mergeServerLog(room.log);
  _runEffects(room, g, players, curId);

  _renderTopbar(room, players, curId, isMyTurn, phase);
  _renderTable(room);
  _renderDrawer(room);
  _renderOwn(room, canActTrump, canActUno, iFinished);
}

// ----------------------------------------
// 演出（actionLog増分＋状態diff駆動）
//
// 同期のたびに「前回から増えた actionLog エントリ」（誰が何をしたか）と
// 「状態のdiff」（場流し・リバース・上がり等の結果）から演出を導出し、
// 順次再生キューへ積む。全クライアントが同じデータを受け取るため、
// 演出も全員の画面で同期する。
// 状態表示は即時・演出は上乗せ（演出のために描画は一切遅らせない）。
// ----------------------------------------
function _runEffects(room: any, g: any, players: Player[], curId: string | undefined): void {
  const snap = takeSnapshot(g, room);

  // ★バグ修正（二戦目開始でリバース演出が出る）★
  // 同じルームで再戦すると roomId は変わらないため prevSnap がリセットされず、
  // 一戦目終盤の状態（dir=-1 等）と二戦目開始状態（dir=1）の差分を誤って
  // リバース等として演出してしまっていた。actionLog または rankings が
  // 「減った」＝ロビー経由で新しいゲームに切り替わった、とみなして
  // 演出の既読状態を初期化し、ゲーム開始演出を正しく再生できるようにする。
  if (prevSnap !== null &&
      (snap.actionLogLen < prevSnap.actionLogLen ||
       snap.rankingIds.length < prevSnap.rankingIds.length)) {
    prevSnap = null;
    seenTrumpEffectTs = null;
    prevTurnId = null;
    prevDir = null;
    clearEffectQueue();
  }

  const descs: EffectDescriptor[] = [];

  // A. actionLog の増分（行為者中心の演出）
  if (prevSnap !== null && snap.actionLogLen > prevSnap.actionLogLen) {
    const log: any[] = Array.isArray(room.actionLog) ? room.actionLog : [];
    descs.push(...deriveFromEntries(log.slice(prevSnap.actionLogLen)));
  }

  // B. 状態diff（結果中心の演出。初回はゲーム開始判定のみ）
  descs.push(...deriveFromDiff(prevSnap, snap, g, players));

  // C. trumpEffect（8切り・革命・しばり等の特殊効果バナー）
  // 初回同期では再生せず「既読ts」を初期化するだけ（リロード時に古い演出が
  // 再生されるのを防ぐ）。★trumpEffectがまだ存在しない場合も0で初期化する★
  // （でないと最初に発生した特殊効果が「初回扱い」でスキップされてしまう）
  const te = g.trumpEffect;
  const teTs = (te && typeof te.ts === 'number') ? te.ts : 0;
  if (seenTrumpEffectTs === null) {
    seenTrumpEffectTs = teTs;
  } else if (teTs !== 0 && teTs !== seenTrumpEffectTs) {
    seenTrumpEffectTs = teTs;
    const desc = deriveTrumpSpecial(te, !!g.trumpRevolution);
    if (desc) descs.push(desc);
  }

  prevSnap = snap;
  if (descs.length > 0) {
    enqueueEffects(descs, d => playEffect(d, players, state.myId));
  }

  // 手番が移ったときの演出（毎ターン発生するためキューに乗せず即時・並行で再生）
  // 自分の番は「気づかない」問題への対応として専用の目立つ演出を出し、
  // 他人の番は席のリングを一瞬光らせるだけにする。
  // curId は空文字IDでも成立するよう、真偽値ではなく明示的に null/undefined を除外する
  if (prevTurnId !== null && curId != null && curId !== prevTurnId) {
    const iFinishedNow = (g.rankings || []).some((r: { id: string }) => r.id === state.myId);
    if (curId === state.myId && !iFinishedNow) {
      flashMyTurn();
    } else {
      flashTurnArrival(curId, state.myId);
    }
  }
  prevTurnId = curId ?? null;

  // 回転方向が変わったら方向マークの位置で大きく点滅させる
  // （リバース演出とは別に、マーク自体の変化もはっきり伝える）
  if (prevDir !== null && typeof g.dir === 'number' && g.dir !== prevDir) {
    flashDirChange(g.dir === 1);
  }
  prevDir = typeof g.dir === 'number' ? g.dir : prevDir;

  // リアクション表示（誰のリアクションも席の上にポップさせる）
  // ★「他プレイヤーのリアクションがPC UIで見えない」問題の修正★
  _runReactionEffects(room);
}

/**
 * room.reactions の ts 変化を検知して、そのプレイヤーの席にリアクションを出す。
 * 全プレイヤー分（自分含む）を表示するため、送信者以外の画面でも見える。
 */
function _runReactionEffects(room: any): void {
  const reactions: Record<string, { emoji: string; ts: number; targetId?: string } | undefined> = room.reactions || {};

  // 初回同期では過去のリアクションを再生せず、既読位置だけ記録する
  if (prevReactionTs === null) {
    prevReactionTs = {};
    for (const id of Object.keys(reactions)) {
      const r = reactions[id];
      if (r && typeof r.ts === 'number') prevReactionTs[id] = r.ts;
    }
    return;
  }

  const now = Date.now();
  for (const id of Object.keys(reactions)) {
    const r = reactions[id];
    if (!r || typeof r.ts !== 'number') continue;
    const seen = prevReactionTs[id] ?? 0;
    if (r.ts > seen) {
      prevReactionTs[id] = r.ts;
      // 8秒以上前の古いリアクションは再生しない（再接続時の一斉再生防止）
      if (now - r.ts < 8000 && r.emoji) {
        // 全体OFF: 自己・対人とも一切表示しない（既読位置は上で更新済みなので
        // 再ONにしても過去分は蘇らない）
        if (areReactionsOff()) continue;
        if (r.targetId) {
          // 対人リアクション: ブロックした相手からのものは自分の画面に出さない
          // （送信者には通知しない＝受信側クライアントで描画スキップ）
          if (isReactorBlocked(id)) continue;
          playDirectedReaction(r.emoji, id, r.targetId, state.myId);
          // 被弾トースト（自分が宛先のとき）
          if (r.targetId === state.myId) {
            const fromName = lastRoom?.players?.find((p: Player) => p.id === id)?.name ?? '？';
            playHitToast(r.emoji, fromName);
          }
        } else {
          playReaction(r.emoji, id, state.myId);
        }
      }
    }
  }
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

  // バッジはクリックで引き出しのルールタブの該当説明へジャンプできる（rule-jump）
  const badges: string[] = [];
  if (g.trumpRevolution) badges.push('<span class="pcg-badge pcg-badge-rev" data-action="rule-jump" data-rule="rev" title="クリックでルール説明を見る">🌀 革命中</span>');
  if (g.trumpElevenBack) badges.push('<span class="pcg-badge pcg-badge-jback" data-action="rule-jump" data-rule="jback" title="クリックでルール説明を見る">🔄 Jバック</span>');
  if (Array.isArray(g.trumpSuitLock) && g.trumpSuitLock.length > 0) {
    badges.push(`<span class="pcg-badge pcg-badge-lock" data-action="rule-jump" data-rule="lock" title="クリックでルール説明を見る">⛓ ${g.trumpSuitLock.join('')}しばり</span>`);
  }
  // ★ルール追加（UNO残り1人）★ +2/+4のドロー効果が無効になっている状態を明示
  if (countUnoActivePlayers(g) === 1) {
    badges.push('<span class="pcg-badge pcg-badge-solo" data-action="rule-jump" data-rule="solo" title="クリックでルール説明を見る">🎴 UNO残り1人（+2/+4無効）</span>');
  }

  // 回転方向は中央の場の上（renderFieldHtml）に記号で表示するため、
  // 上部バーからは外した（目立たず見落としやすかったため）。
  // 情報部だけを再描画する（右端の操作ボタンは index.html の静的DOM）
  setZone('pcg-topbar-info', `
    <span class="pcg-room">ルーム ${state.roomId || '----'}</span>
    ${turnHtml}
    ${badges.join('')}
    <span class="pcg-spacer"></span>
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
  const leftPlayers: Record<string, boolean> = room.leftPlayers || {};
  const curId = g.order?.[g.ci];

  // 自分以外を手番順（自分基準に回転）で上弧に配置する。
  // ★席は動かさない★ g.order は上がったプレイヤーが抜けて縮むため、
  // それを使うと誰かが上がるたびに席が詰まって混乱する。ゲーム開始時の
  // 手番順（replayInitialState.order）で計算して席を固定する
  // （古いルームで無い場合のみ g.order にフォールバック）。
  const initialOrder: string[] = Array.isArray(room.replayInitialState?.order)
    ? room.replayInitialState.order
    : (Array.isArray(g.order) ? g.order : []);
  const others = othersInTurnOrder(initialOrder, players.map(p => p.id), state.myId);
  const positions = seatPositions(others);
  const seatsHtml = positions
    .map(pos => renderSeatHtml(pos, { g, players, autoPlayers, leftPlayers, curId, actionLog: room.actionLog }))
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
    ${_ownHeaderHtml(g, players)}
    ${_handRowsHtml(g, canActTrump, canActUno, iFinished)}
    ${renderActionBarHtml(bar, reactionOpen, autoAdvancing)}
  `);
}

/**
 * 自分エリアのヘッダー（自分の名前の常時表示）。
 * 「自分の席＝下部手札エリア」の空間原則に合わせて、席と同じ
 * アバター＋名前＋👑（親のとき）をここに出す。
 */
function _ownHeaderHtml(g: any, players: Player[]): string {
  const idx = players.findIndex(p => p.id === state.myId);
  const name = idx !== -1 ? players[idx]!.name : (state.myName || '?');
  const color = AVATAR_COLORS[Math.max(0, idx) % 5];
  const isParent = g.hasParent === state.myId;
  const me = idx !== -1 ? players[idx] : undefined;
  return `
    <div class="pcg-own-head">
      <span class="pcg-own-avatar" style="background:${color}">
        ${me?.icon ? `<span class="pcg-avatar-icon">${me.icon}</span>` : name.slice(0, 1).toUpperCase()}
        ${isParent ? '<span class="pcg-crown">👑</span>' : ''}
      </span>
      <span class="pcg-own-name">${name}</span>
      ${me?.title ? `<span class="pcg-own-title">${me.title}</span>` : ''}
      <span class="pcg-own-you">あなた</span>
    </div>
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
    case 'react-emoji': {
      // 対人リアクション送信（クールダウン中は無視）
      if (isDirectedOnCooldown()) break;
      const targetId = target.dataset.target!;
      closeReactionMenu();
      directedCooldownUntil = Date.now() + DIRECTED_COOLDOWN_MS;
      await window.sendReaction(target.dataset.emoji!, targetId);
      break;
    }
    case 'duel-challenge': {
      // ★ヨットモード Step 2★ ヨット対決を挑む（発動時点でスキル消費）
      const targetId = target.dataset.target!;
      closeReactionMenu();
      await window.duelChallenge(targetId);
      break;
    }
    case 'react-block': {
      // ブロック状態をトグルし、メニュー表示を更新（開いたまま）
      const targetId = target.dataset.target!;
      toggleReactorBlock(targetId);
      const seatEl = document.querySelector<HTMLElement>(`.pcg-seat[data-seat-id="${targetId}"]`);
      if (seatEl) openReactionMenu(seatEl, targetId);
      break;
    }
    case 'reactions-toggle':
      // 全リアクション表示ON/OFF（引き出しパネルの設定トグル）
      toggleReactionsOff();
      break;
    case 'drawer-toggle':
      toggleDrawer();
      break;
    case 'drawer-tab':
      setDrawerTab(target.dataset.tab!);
      break;
    case 'bug-report':
      // ★バグ報告★ モーダルを開く（bug-report-ui.ts が window に登録）
      window.openBugReport();
      break;
    case 'rule-jump': {
      // 上部バッジ→引き出しのルールタブを開き、該当説明へスクロール＆点滅
      openDrawer();
      setDrawerTab('rules');
      const key = target.dataset.rule!;
      // この後の rerenderPc() で引き出しが開いた状態のDOMになってから飛ぶ
      setTimeout(() => {
        const el = document.getElementById('pcg-rule-' + key);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1800);
      }, 60);
      break;
    }
  }
  rerenderPc();
}

function _onPcClick(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  const target = el.closest<HTMLElement>(
    '[data-action], [data-tcard-id], [data-ucard-idx]'
  );
  const seatEl = el.closest<HTMLElement>('.pcg-seat[data-seat-id]');
  const insideMenu = !!el.closest('#pcg-reaction-menu');

  // メニュー外クリックで閉じる（メニュー内のボタンと席クリックは除外）。
  // 席クリックは下で開き直す／トグルするので、ここでは閉じない。
  if (openMenuTargetId && !insideMenu && !seatEl) {
    closeReactionMenu();
  }

  if (target) {
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
      return;
    }
  }

  // 席クリック → 対人リアクションメニュー（同じ席をもう一度押すと閉じる）
  if (seatEl) {
    const id = seatEl.dataset.seatId!;
    if (openMenuTargetId === id) {
      closeReactionMenu();
    } else {
      openReactionMenu(seatEl, id);
    }
  }
}

document.getElementById('s-game-pc')?.addEventListener('click', _onPcClick);

// 開発・動作確認用フック
window._pcDebugRender = renderGamePC;
