// ========================================
// フェイズ自動進行
//
// 「手札0枚なのにスキップボタンを押すだけ」の無駄な操作を廃止する。
// 自分の手番が来て該当フェイズの手札が0枚なら、バナー表示のあと
// 自動で既存のスキップアクション（window.trumpSkip / unoSkip）を発火する。
//
// 設計上の要点:
// - 多重発火ガード: Firebase の同期は同じ状態で何度も来るため、
//   「状態キー」(actionLog長 + 手番 + フェイズ) につき1回しか発火しない
// - 自動プレイ(🐒)との共存: 自動プレイON中はボットが自分でスキップを
//   打つため、こちらの自動進行は発動しない（二重発火防止）
// - フェイルセーフ: 発火後 FAILSAFE_MS 経っても状態が進まなければ、
//   操作バーに手動スキップボタンを出す（action-bar側が
//   isAutoAdvanceStuck() を見て trump-skip / uno-skip モードを表示する）
// ========================================
import { state } from '../../state.js';

/** バナー表示から実際に発火するまでの猶予（演出時間） */
const FIRE_DELAY_MS = 800;
/** 発火後にこの時間たっても状態が進まなければ手動ボタンに切り替える */
const FAILSAFE_MS = 3000;

let firedKey: string | null = null;
let firedAt = 0;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

function stateKey(room: any): string {
  const g = room.game;
  const logLen = Array.isArray(room.actionLog) ? room.actionLog.length : 0;
  return `${logLen}:${g.ci}:${g.phase}:${g.order?.length ?? 0}`;
}

/**
 * 自動進行すべき状態かを判定する。
 * 戻り値: 'trump' | 'uno'（スキップすべきフェイズ）| null
 */
export function shouldAutoAdvance(room: any, myId: string): 'trump' | 'uno' | null {
  const g = room?.game;
  if (!g || room.state !== 'playing') return null;
  if (g.order?.[g.ci] !== myId) return null;
  if ((g.rankings || []).some((r: { id: string }) => r.id === myId)) return null;
  // 自動プレイON中はボットに任せる（二重発火防止）。
  // autoPlayers はFirebase経由で同期が一拍遅れるため、
  // ローカルの即時フラグ（window._botActive）も併せて見る
  if (room.autoPlayers && room.autoPlayers[myId]) return null;
  if (typeof window !== 'undefined' && window._botActive) return null;

  const phase = g.phase || 'trump';
  if (phase === 'trump') {
    const hand = (g.trumpHands && g.trumpHands[myId]) || [];
    return hand.length === 0 ? 'trump' : null;
  }
  // 親の権限（UNO色変更）を持っている間は自動で進めない。
  // 自動スキップすると「色を変更するか・使わず進むか」を選ぶ機会を
  // 奪ってしまうため、このケースだけは手動ボタンに任せる。
  if (g.hasParent === myId) return null;
  const hand = (g.unoHands && g.unoHands[myId]) || [];
  return hand.length === 0 ? 'uno' : null;
}

/**
 * 自動進行の発火が滞っているか（フェイルセーフ用）。
 * true のとき操作バーは手動スキップボタンを表示する。
 */
export function isAutoAdvanceStuck(room: any): boolean {
  return firedKey === stateKey(room) && Date.now() - firedAt > FAILSAFE_MS;
}

/**
 * 描画のたびに呼ぶ。条件を満たしていれば（1状態につき1回だけ）
 * バナー猶予の後にスキップアクションを自動発火する。
 *
 * 戻り値: このrenderで自動進行が予約中/発火済みなら true
 * （操作バーはこれを見て「自動進行中…」の表示にする）
 */
export function maybeAutoAdvance(room: any, rerender: () => void): boolean {
  const target = shouldAutoAdvance(room, state.myId);
  if (!target) return false;

  const key = stateKey(room);
  if (firedKey === key) {
    // 既にこの状態では発火済み（結果待ち）。フェイルセーフ判定だけ更新
    return !isAutoAdvanceStuck(room);
  }

  firedKey = key;
  firedAt = Date.now();

  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    try {
      if (target === 'trump') await window.trumpSkip();
      else await window.unoSkip();
    } finally {
      // フェイルセーフ表示の切り替えのために再描画しておく
      setTimeout(rerender, FAILSAFE_MS + 100);
    }
  }, FIRE_DELAY_MS);

  return true;
}

/** テスト用: 発火ガードをリセットする */
export function _resetAutoAdvanceForTest(): void {
  firedKey = null;
  firedAt = 0;
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}
