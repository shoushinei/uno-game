// ========================================
// mobile-seat-layout.ts 単体テスト
//
// 「卓を時計回りに囲む」並びを守れているかを固める。
// 手番順そのものの計算は pc/seat-layout.ts（othersInTurnOrder）の担当で、
// ここはその結果を左右へ割り振る部分だけを見る。
// ========================================
import { describe, it, expect } from 'vitest';
import { splitMobileSeats } from './mobile-seat-layout.js';
import { othersInTurnOrder } from './pc/seat-layout.js';

/** 席を「左下 → 左上 → 右上 → 右下」の順に読み直す＝卓を一周する順 */
function walkAround({ left, right }) {
  return [...[...left].reverse(), ...right];
}

describe('splitMobileSeats', () => {
  it('★自分の次の手番の人が「左の下」に来る★（環の⟳と回る向きを合わせる）', () => {
    const { left } = splitMobileSeats(['次', 'その次', 'さらに次']);
    expect(left[left.length - 1]).toBe('次');
  });

  it('左下から一周すると手番順に戻る', () => {
    const others = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'];
    expect(walkAround(splitMobileSeats(others))).toEqual(others);
  });

  it('8人（他7人）は左4・右3に分かれ、横スクロールなしで全員入る', () => {
    const s = splitMobileSeats(['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']);
    expect(s.left).toEqual(['o4', 'o3', 'o2', 'o1']);
    expect(s.right).toEqual(['o5', 'o6', 'o7']);
  });

  it('3人（他2人）は左右に1人ずつ', () => {
    expect(splitMobileSeats(['o1', 'o2'])).toEqual({ left: ['o1'], right: ['o2'] });
  });

  it('奇数なら左を1人多くする（手番が早い側を厚くする）', () => {
    const s = splitMobileSeats(['o1', 'o2', 'o3']);
    expect(s.left).toHaveLength(2);
    expect(s.right).toHaveLength(1);
  });

  it('自分以外が居なくても壊れない', () => {
    expect(splitMobileSeats([])).toEqual({ left: [], right: [] });
  });

  it('全員が必ずどちらかの列に1回だけ入る', () => {
    for (let n = 0; n <= 7; n++) {
      const others = Array.from({ length: n }, (_, i) => `o${i}`);
      const { left, right } = splitMobileSeats(others);
      expect([...left, ...right].sort()).toEqual([...others].sort());
    }
  });

  it('元の配列を書き換えない（reverse の破壊性に注意）', () => {
    const others = ['o1', 'o2', 'o3'];
    splitMobileSeats(others);
    expect(others).toEqual(['o1', 'o2', 'o3']);
  });
});

describe('othersInTurnOrder との組み合わせ', () => {
  it('自分が真ん中にいても、左下＝自分の次の手番になる', () => {
    const order = ['a', 'me', 'b', 'c'];
    const others = othersInTurnOrder(order, ['a', 'me', 'b', 'c'], 'me');
    const { left, right } = splitMobileSeats(others);
    expect(left[left.length - 1]).toBe('b');          // 自分の次
    expect(walkAround({ left, right })).toEqual(['b', 'c', 'a']);
  });

  it('上がり済みのプレイヤーは最後（右列の下）に置かれる', () => {
    // 'x' は上がって order から抜けている
    const others = othersInTurnOrder(['me', 'b', 'c'], ['me', 'b', 'c', 'x'], 'me');
    const { right } = splitMobileSeats(others);
    expect(right[right.length - 1]).toBe('x');
  });
});
