// ========================================
// ターン持ち時間（手番の制限時間）の純粋ロジック
//
// 手番になったら各フェイズ最大 TURN_LIMIT_MS の持ち時間があり、
// 時間切れは「その場の最も無難な行動」に自動で置き換える:
//  - トランプフェイズ → パス
//  - UNOフェイズ       → 1枚引く（＝パス扱い）
//  - ヨット対決        → 現在の持ちサイコロで確定（未振りなら1回振る）
//
// 「誰が締め切りを刻み・誰が強制するか」はホスト単一権威（absent-runner と
// 同じモデル）。このファイルは DOM・Firebase 非依存の純粋関数だけを持ち、
// 締め切りの生成（絶対時刻）・残り秒数・強制種別の判定を提供する。
//
// ★設定点★ 持ち時間の秒数はここ 1 箇所（TURN_LIMIT_MS）で決める。将来
// ルームごとに変えたくなったら room から読むように差し替えられる形にしてある。
// ========================================
import type { DuelState } from './duel-logic.js';

/** 手番の持ち時間（ミリ秒）。当面は全フェイズ・対決とも 60 秒 */
export const TURN_LIMIT_MS = 60_000;

/**
 * 現在の「手番識別キー」。actionLog長＋手番index＋フェイズが変わるたびに
 * 別キーになる。手番が無い状態（ゲーム未開始・終了・duel中など）は null。
 * 締め切りは「キーが変わったら刻み直す」ことでフェイズ切替ごとにリセットされる。
 */
export function turnKey(room: any): string | null {
  const g = room?.game;
  if (!g || room?.state !== 'playing') return null;
  if (room?.duel) return null; // 対決中は通常の手番タイマーを止める（duelKey 側で管理）
  if (!Array.isArray(g.order) || g.order.length === 0) return null;
  const curId = g.order[g.ci];
  if (!curId) return null;
  const logLen = Array.isArray(room.actionLog) ? room.actionLog.length : 0;
  const phase = g.phase || 'trump';
  return `${logLen}:${g.ci}:${phase}`;
}

/**
 * 対決の「振り識別キー」。振る側＋残り振り回数が変わるたびに別キーになる
 * （振り直しごと・攻守交代ごとにリセット）。rolling でなければ null。
 */
export function duelKey(duel: DuelState | null | undefined): string | null {
  if (!duel || duel.stage !== 'rolling') return null;
  const side = duel.turn === 'attacker' ? duel.attacker : duel.defender;
  const rollsLeft = typeof side?.rollsLeft === 'number' ? side.rollsLeft : 0;
  return `${duel.startedAt}:${duel.turn}:${rollsLeft}`;
}

/** 表示用の残り秒数（切り上げ・0未満は0）。deadline が無効なら null */
export function remainingSec(deadline: number | null | undefined, now: number): number | null {
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * 締め切りが「今のキー」に対して有効か（刻み待ちの一瞬を弾く）。
 * 保存キーと現在キーが一致し、かつ現在キーが手番ありのときだけ true。
 */
export function deadlineActive(currentKey: string | null, savedKey: unknown): boolean {
  return currentKey !== null && typeof savedKey === 'string' && savedKey === currentKey;
}

/**
 * 手番タイムアウト時に打つべき行動の種別（純粋判定）。
 * actorId が現在の手番でなければ null。
 *  - trump フェイズ → 'trump-pass'
 *  - uno   フェイズ → 'uno-draw'
 * （手札0枚の自動スキップは auto-advance が先に処理するが、ここでは
 *   フェイズだけで種別を返す。空振りしても既存アクションの手番ガードで無害）
 */
export function timeoutKind(room: any, actorId: string): 'trump-pass' | 'uno-draw' | null {
  const g = room?.game;
  if (!g || room?.state !== 'playing' || room?.duel) return null;
  if (!Array.isArray(g.order) || g.order[g.ci] !== actorId) return null;
  return (g.phase || 'trump') === 'trump' ? 'trump-pass' : 'uno-draw';
}

/**
 * 対決タイムアウト時に打つべき手（純粋判定）。
 *  - まだ1度も振っていない（dice空）→ roll（その60秒枠の1操作）
 *  - 既に振っている               → commit（現在の持ちサイコロで確定）
 * rolling でなければ null。
 */
export function duelTimeoutMove(
  duel: DuelState | null | undefined
): { type: 'roll' } | { type: 'commit' } | null {
  if (!duel || duel.stage !== 'rolling') return null;
  const side = duel.turn === 'attacker' ? duel.attacker : duel.defender;
  const dice = Array.isArray(side?.dice) ? side.dice : [];
  return dice.length === 0 ? { type: 'roll' } : { type: 'commit' };
}
