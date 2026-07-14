// ========================================
// 演出の再生キュー
//
// 1回の同期で複数の演出が発生した場合に順番に再生する。
// bot対戦（約1秒間隔で操作が来る）に置いていかれないよう、
// キューが上限を超えたら「古い未再生の演出」から捨てる
// （「全部見せる」より「今を見せる」を優先する）。
// ========================================
import type { EffectDescriptor } from './effect-derive.js';

/** 未再生キューの上限。超えた分は古い順に捨てる */
export const QUEUE_MAX = 4;

/**
 * キューの間引き（純粋関数・テスト対象）。
 * 上限を超えた場合、新しい方から QUEUE_MAX 件だけ残す。
 */
export function trimQueue<T>(queue: T[], max: number = QUEUE_MAX): T[] {
  if (queue.length <= max) return queue;
  return queue.slice(queue.length - max);
}

type PlayFn = (desc: EffectDescriptor) => Promise<void>;

let pending: EffectDescriptor[] = [];
let playing = false;

/**
 * 演出をキューに積み、再生ループが止まっていれば起動する。
 * play の実装（DOM演出）は effect-render.ts から注入される。
 */
export function enqueueEffects(descs: EffectDescriptor[], play: PlayFn): void {
  if (descs.length === 0) return;
  pending = trimQueue([...pending, ...descs]);
  if (playing) return;
  playing = true;
  void (async () => {
    try {
      while (pending.length > 0) {
        const desc = pending.shift()!;
        try {
          await play(desc);
        } catch (e) {
          // 演出の失敗はゲーム進行に影響させない
          console.error('演出の再生でエラー:', desc.kind, e);
        }
      }
    } finally {
      playing = false;
    }
  })();
}

/** テスト・ルーム切替用: キューを空にする */
export function clearEffectQueue(): void {
  pending = [];
}
