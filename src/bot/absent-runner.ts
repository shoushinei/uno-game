// ========================================
// 退室者の代行実行（Phase C4）
//
// ゲーム進行中に退室したプレイヤー（leftPlayers）の手番を、ホストの
// クライアントが自動で代行プレイする。
//
// 設計上の要点:
// - ★ホストだけが実行する★ … room.host === state.myId のときのみ動く。
//   ホストは常に一意なので、代行が二重に走らない（構造的な多重防止）。
// - 対象は「今の手番プレイヤーが leftPlayers に含まれる」場合のみ。
//   ホスト自身は leftPlayers に入らない（退室時にホスト移譲するため）ので、
//   人間の手番を勝手に進めることはない。
// - 退室者のブラウザは閉じているので test-bot とは競合しない
//   （test-bot は各自のブラウザでのみ動く）。
// - 思考は decideBotPlan、実行は executeBotPlan（strategy/execute）を共有。
// ========================================
import { state } from '../state.js';
import { decideBotPlan } from './strategy.js';
import { executeBotPlan } from './execute.js';

const TICK_MS = 1100; // test-bot(800ms) とずらして同時発火を避ける

/**
 * 「今このクライアントが代行すべき退室者ID」を返す（純粋関数・テスト対象）。
 * 代行不要なら null。
 *
 * 条件:
 *  - 自分がホストである（host === myId）
 *  - ゲーム進行中である
 *  - 今の手番プレイヤーが leftPlayers に含まれる（＝退室者）
 */
export function absentActorToRun(params: {
  roomHost: string | null;
  roomState: string | null;
  myId: string;
  order: string[] | undefined;
  ci: number;
  leftPlayers: Record<string, boolean>;
}): string | null {
  const { roomHost, roomState, myId, order, ci, leftPlayers } = params;
  if (!roomHost || roomHost !== myId) return null;
  if (roomState !== 'playing') return null;
  if (!Array.isArray(order) || order.length === 0) return null;
  const curId = order[ci];
  if (!curId) return null;
  return leftPlayers[curId] ? curId : null;
}

let timer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

async function tick(): Promise<void> {
  if (isProcessing) return;

  const g = window._currentGame;
  if (!g) return;

  const curId = absentActorToRun({
    roomHost: window._roomHost,
    roomState: window._roomState,
    myId: state.myId,
    order: g.order,
    ci: g.ci,
    leftPlayers: window._leftPlayers || {},
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
