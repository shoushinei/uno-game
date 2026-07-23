// ========================================
// yacht-logic.ts 単体テスト（役計算・振り直し・勝敗）
// ========================================
import { describe, it, expect } from 'vitest';
import {
  rollDice, reroll, scoreAll, bestHand, judgeDuel, MAX_ROLLS, DICE_COUNT,
} from './yacht-logic.ts';

const score = (dice, cat) => scoreAll(dice).find(h => h.category === cat).score;

describe('rollDice / reroll', () => {
  it('5個すべて1〜6の目', () => {
    const d = rollDice(DICE_COUNT);
    expect(d).toHaveLength(5);
    expect(d.every(x => x >= 1 && x <= 6)).toBe(true);
  });

  it('rand注入で決定的（rand=0 → 全部1）', () => {
    expect(rollDice(5, () => 0)).toEqual([1, 1, 1, 1, 1]);
  });

  it('reroll は keep=true の目を保持し、他を振り直す（入力は不変）', () => {
    const src = [6, 5, 4, 3, 2];
    const out = reroll(src, [true, false, true, false, true], () => 0.99);
    expect(out).toEqual([6, 6, 4, 6, 2]); // rand=0.99 → 6
    expect(src).toEqual([6, 5, 4, 3, 2]);
  });

  it('MAX_ROLLS は 3（初回1 + 振り直し2）', () => {
    expect(MAX_ROLLS).toBe(3);
  });
});

describe('scoreAll — 役計算', () => {
  it('ヨット（5個同じ）= 50点', () => {
    expect(score([4, 4, 4, 4, 4], 'yacht')).toBe(50);
    expect(score([4, 4, 4, 4, 5], 'yacht')).toBe(0);
  });

  it('ビッグストレート（5連続）= 30点', () => {
    expect(score([1, 2, 3, 4, 5], 'big-straight')).toBe(30);
    expect(score([2, 3, 4, 5, 6], 'big-straight')).toBe(30);
    expect(score([5, 4, 3, 2, 6], 'big-straight')).toBe(30); // 順不同OK
    expect(score([1, 2, 3, 4, 6], 'big-straight')).toBe(0);
  });

  it('スモールストレート（4連続を含む）= 15点', () => {
    expect(score([1, 2, 3, 4, 6], 'small-straight')).toBe(15);
    expect(score([3, 4, 5, 6, 6], 'small-straight')).toBe(15);
    expect(score([1, 2, 3, 5, 6], 'small-straight')).toBe(0);
    expect(score([1, 2, 3, 4, 5], 'small-straight')).toBe(15); // 5連続は4連続も含む
  });

  it('フルハウス（3+2）= 合計。5個同一や4+1は対象外', () => {
    expect(score([3, 3, 3, 5, 5], 'full-house')).toBe(19);
    expect(score([6, 6, 6, 6, 6], 'full-house')).toBe(0);
    expect(score([2, 2, 2, 2, 5], 'full-house')).toBe(0);
  });

  it('フォーナンバーズ（4個以上同じ）= 合計。5個同一も対象', () => {
    expect(score([2, 2, 2, 2, 5], 'four-numbers')).toBe(13);
    expect(score([6, 6, 6, 6, 6], 'four-numbers')).toBe(30);
    expect(score([2, 2, 2, 5, 5], 'four-numbers')).toBe(0);
  });

  it('1〜6 = その目だけの合計', () => {
    const d = [1, 1, 3, 6, 6];
    expect(score(d, '1')).toBe(2);
    expect(score(d, '3')).toBe(3);
    expect(score(d, '6')).toBe(12);
    expect(score(d, '5')).toBe(0);
  });

  it('チョイスは廃止（役一覧に存在しない）', () => {
    expect(scoreAll([1, 1, 3, 6, 6]).some(h => h.category === 'choice')).toBe(false);
  });
});

describe('bestHand — 最高役', () => {
  it('ヨットが最優先で50点', () => {
    expect(bestHand([6, 6, 6, 6, 6])).toEqual({ category: 'yacht', score: 50 });
  });

  it('ビッグストレートは30点', () => {
    expect(bestHand([2, 3, 4, 5, 6])).toEqual({ category: 'big-straight', score: 30 });
  });

  it('役なしのバラバラな手は「一番多い目の合計」が最高（チョイス廃止）', () => {
    // [1,1,2,3,5] は役なし。目別合計は 1→2, 2→2, 3→3, 5→5 で 5 が最大
    const b = bestHand([1, 1, 2, 3, 5]);
    expect(b.score).toBe(5);
    expect(b.category).toBe('5');
  });

  it('4個同一はフォーナンバーズ（合計26）', () => {
    const b = bestHand([6, 6, 6, 6, 2]);
    expect(b.score).toBe(26);
    expect(b.category).toBe('four-numbers');
  });
});

describe('judgeDuel — 勝敗', () => {
  it('高得点側が勝つ', () => {
    expect(judgeDuel(30, 15)).toBe('attacker');
    expect(judgeDuel(15, 50)).toBe('defender');
  });
  it('同点は引き分け（誰もUNOを引かない）', () => {
    expect(judgeDuel(20, 20)).toBe('draw');
  });
});
