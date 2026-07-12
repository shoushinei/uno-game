// ========================================
// seat-layout.ts 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import { othersInTurnOrder, seatPositions } from './seat-layout.js';

describe('othersInTurnOrder', () => {
  it('自分の次の手番のプレイヤーが先頭に来る', () => {
    const order = ['p1', 'me', 'p3', 'p4'];
    const all = ['p1', 'me', 'p3', 'p4'];
    expect(othersInTurnOrder(order, all, 'me')).toEqual(['p3', 'p4', 'p1']);
  });

  it('自分が先頭でも末尾でも正しく一周する', () => {
    expect(othersInTurnOrder(['me', 'a', 'b'], ['me', 'a', 'b'], 'me')).toEqual(['a', 'b']);
    expect(othersInTurnOrder(['a', 'b', 'me'], ['a', 'b', 'me'], 'me')).toEqual(['a', 'b']);
  });

  it('上がり済み（orderにいない）プレイヤーは末尾に付く', () => {
    const order = ['me', 'p2'];
    const all = ['me', 'p2', 'p9'];
    expect(othersInTurnOrder(order, all, 'me')).toEqual(['p2', 'p9']);
  });

  it('自分が上がり済みの場合は order 順のまま', () => {
    const order = ['p2', 'p3'];
    const all = ['me', 'p2', 'p3'];
    expect(othersInTurnOrder(order, all, 'me')).toEqual(['p2', 'p3']);
  });
});

describe('seatPositions', () => {
  it('人数分の座標を返す', () => {
    for (const n of [1, 2, 3, 5, 7]) {
      const ids = Array.from({ length: n }, (_, i) => 'p' + i);
      expect(seatPositions(ids).length).toBe(n);
    }
  });

  it('座標はテーブル領域（0〜100%）に収まる', () => {
    const ids = Array.from({ length: 7 }, (_, i) => 'p' + i);
    for (const pos of seatPositions(ids)) {
      expect(pos.xPercent).toBeGreaterThanOrEqual(0);
      expect(pos.xPercent).toBeLessThanOrEqual(100);
      expect(pos.yPercent).toBeGreaterThanOrEqual(0);
      expect(pos.yPercent).toBeLessThanOrEqual(100);
    }
  });

  it('左から右へ並ぶ（xが単調増加）', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const xs = seatPositions(ids).map(p => p.xPercent);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('席同士が重ならない程度に離れている（7人時）', () => {
    const ids = Array.from({ length: 7 }, (_, i) => 'p' + i);
    const ps = seatPositions(ids);
    for (let i = 1; i < ps.length; i++) {
      const dx = ps[i].xPercent - ps[i - 1].xPercent;
      const dy = ps[i].yPercent - ps[i - 1].yPercent;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeGreaterThan(8);
    }
  });

  it('空配列なら空を返す', () => {
    expect(seatPositions([])).toEqual([]);
  });
});
