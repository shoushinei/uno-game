// ========================================
// 退室者・ボットの代行実行（Phase C4 / ロビーボット）
//
// ゲーム進行中の以下2種の手番を、ホストのクライアントが自動でプレイする:
//  - 退室したプレイヤー（leftPlayers）… Phase C4
//  - ロビーで追加されたボット（botPlayers, isBot）… ロビーボット
// どちらも「本人のブラウザで操作されない席」なので同じ代行で処理できる。
//
// 設計上の要点:
// - ★ホストだけが実行する★ … room.host === state.myId のときのみ動く。
//   ホストは常に一意なので、代行が二重に走らない（構造的な多重防止）。
// - 対象は「今の手番プレイヤーが退室者 or ボット」の場合のみ。
//   ホスト自身は leftPlayers/botPlayers に入らないので、人間（ホスト）の
//   手番を勝手に進めることはない。ホスト移譲時もボットは移譲先から除外する
//   （ボットがホストだと代行実行者が居なくなり進行が止まるため）。
// - 思考は decideBotPlan、実行は executeBotPlan（strategy/execute）を共有。
// ========================================
import { state } from '../state.js';
import { decideBotPlan } from './strategy.js';
import { executeBotPlan } from './execute.js';
import { currentActorId, decideDuelMove } from '../logic/duel-logic.js';
import { actionYachtRoll, actionYachtCommit, actionYachtClose } from '../actions/yacht-actions.js';

const TICK_MS = 1100; // test-bot(800ms) とずらして同時発火を避ける

/**
 * 「今このクライアントが代行すべき席のID」を返す（純粋関数・テスト対象）。
 * 代行不要なら null。
 *
 * 条件:
 *  - 自分がホストである（host === myId）
 *  - ゲーム進行中である
 *  - 今の手番プレイヤーが leftPlayers（退室者）または botPlayers（ボット）
 */
export function absentActorToRun(params: {
  roomHost: string | null;
  roomState: string | null;
  myId: string;
  order: string[] | undefined;
  ci: number;
  leftPlayers: Record<string, boolean>;
  botPlayers?: Record<string, boolean>;
}): string | null {
  const { roomHost, roomState, myId, order, ci, leftPlayers, botPlayers } = params;
  if (!roomHost || roomHost !== myId) return null;
  if (roomState !== 'playing') return null;
  if (!Array.isArray(order) || order.length === 0) return null;
  const curId = order[ci];
  if (!curId) return null;
  const isAbsent = !!leftPlayers[curId];
  const isBot = !!(botPlayers && botPlayers[curId]);
  return isAbsent || isBot ? curId : null;
}

let timer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/** 操作する人が居ない席か（ボット or 退室中） */
function isUnattendedId(id: string): boolean {
  return !!(window._botPlayers && window._botPlayers[id]) ||
         !!(window._leftPlayers && window._leftPlayers[id]);
}

/**
 * ★ヨットモード Step 3★ 対決中の代行。
 * ボット・退室者が対決の手番なら greedy（decideDuelMove）で1手打つ。
 * 決着後、両当事者とも操作不能ならホストが閉じる（ペナルティ適用込み）。
 */
async function duelTick(): Promise<void> {
  if (!window._roomHost || window._roomHost !== state.myId) return; // ホストのみ
  const duel = window._currentDuel;
  if (!duel) return;

  if (duel.stage === 'rolling') {
    const actorId = currentActorId(duel);
    if (!isUnattendedId(actorId)) return; // 人間の手番には介入しない
    const move = decideDuelMove(duel);
    if (!move) return;
    isProcessing = true;
    try {
      const result = move.type === 'roll'
        ? await actionYachtRoll(move.keep, actorId)
        : await actionYachtCommit(actorId);
      if (result?.error) console.warn(`[AbsentRunner] duel ${move.type}(${actorId}) →`, result.error);
    } catch (e) {
      console.error('[AbsentRunner] 対決代行で例外:', e);
    } finally {
      isProcessing = false;
    }
  } else if (duel.stage === 'done') {
    // 当事者に人間が居ればその人が閉じる。全員操作不能ならホストが閉じる
    if (![duel.attackerId, duel.defenderId].every(isUnattendedId)) return;
    isProcessing = true;
    try { await actionYachtClose(); }
    catch (e) { console.error('[AbsentRunner] 対決クローズで例外:', e); }
    finally { isProcessing = false; }
  }
}

async function tick(): Promise<void> {
  if (isProcessing) return;
  // ★ヨットモード Step 2/3★ 対決中は通常の手番代行を止め、対決側の代行を行う
  if (window._duelActive) { await duelTick(); return; }

  const g = window._currentGame;
  if (!g) return;

  const curId = absentActorToRun({
    roomHost: window._roomHost,
    roomState: window._roomState,
    myId: state.myId,
    order: g.order,
    ci: g.ci,
    leftPlayers: window._leftPlayers || {},
    botPlayers: window._botPlayers || {},
  });
  if (!curId) return;

  const trumpHand = (g.trumpHands && g.trumpHands[curId]) || [];
  const unoHand = (g.unoHands && g.unoHands[curId]) || [];
  const plan = decideBotPlan(g, trumpHand, unoHand, curId);
  if (plan.kind === 'none') return;

  isProcessing = true;
  try {
    const result = await executeBotPlan(plan, curId);
    if (result?.error) {
      // 手番が既に進んでいた等の一時的なズレはよくあるので、警告に留める
      console.warn(`[AbsentRunner] ${plan.kind}(${curId}) がエラー →`, result.error);
    }
  } catch (e) {
    console.error('[AbsentRunner] 代行実行で例外:', e);
  } finally {
    isProcessing = false;
  }
}

/** アプリ起動時に1回だけ呼ぶ。以降ずっと監視し続ける（軽量なので停止不要） */
export function startAbsentRunner(): void {
  if (timer) return;
  timer = setInterval(() => { void tick(); }, TICK_MS);
}
