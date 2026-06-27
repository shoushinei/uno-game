// ========================================
// trump-logic.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest'; // ✨ Vitest公式パーツ
import { buildTrumpDeck, trumpStrength, trumpCanPlay, sortTrumpHand } from './trump-logic.js';

// カードオブジェクトを簡単に作るためのサポーター
const c = (s, v) => ({ s, v, id: `${s}${v}` });
const JOKER = { s: '🃏', v: 'JOKER', id: 'JOKER' };

// ========================================
// buildTrumpDeck のテスト
// ========================================
describe('buildTrumpDeck', () => {
  it('53枚のデッキを生成する', () => {
    expect(buildTrumpDeck().length).toBe(53);
  });

  it('JOKERが1枚含まれる', () => {
    const jokers = buildTrumpDeck().filter(c => c.v === 'JOKER');
    expect(jokers.length).toBe(1);
  });
});

// ========================================
// trumpStrength のテスト
// ========================================
describe('trumpStrength', () => {
  it('3が最弱（1）', () => {
    expect(trumpStrength(c('♠','3'))).toBe(1);
  });

  it('2が2番目に強い（13）', () => {
    expect(trumpStrength(c('♠','2'))).toBe(13);
  });

  it('JOKERが最強（14）', () => {
    expect(trumpStrength(JOKER)).toBe(14);
  });

  it('A > K', () => {
    expect(trumpStrength(c('♠','A')) > trumpStrength(c('♠','K'))).toBeTruthy();
  });
});

// ========================================
// trumpCanPlay のテスト
// ========================================
describe('trumpCanPlay', () => {
  it('場が空なら1枚出せる', () => {
    expect(trumpCanPlay([c('♠','5')], [])).toBeTruthy();
  });

  it('場が空なら複数枚出せる', () => {
    expect(trumpCanPlay([c('♠','7'), c('♥','7')], [])).toBeTruthy();
  });

  it('場より強い同枚数は出せる', () => {
    expect(trumpCanPlay([c('♠','9')], [c('♥','5')])).toBeTruthy();
  });

  it('場より弱い場合は出せない', () => {
    expect(trumpCanPlay([c('♠','3')], [c('♥','9')])).toBeFalsy();
  });

  it('場と枚数が違う場合は出せない', () => {
    expect(trumpCanPlay([c('♠','9'), c('♥','9')], [c('♣','5')])).toBeFalsy();
  });

  it('複数枚は同じ数字でないと出せない', () => {
    expect(trumpCanPlay([c('♠','9'), c('♥','8')], [])).toBeFalsy();
  });

  it('選択なしは出せない', () => {
    expect(trumpCanPlay([], [])).toBeFalsy();
  });

  it('JOKERは場が空なら出せる', () => {
    expect(trumpCanPlay([JOKER], [])).toBeTruthy();
  });

  it('JOKERは場のどんなカードにも勝てる', () => {
    expect(trumpCanPlay([JOKER], [c('♠','2')])).toBeTruthy();
  });
});

// ========================================
// sortTrumpHand のテスト
// ========================================
describe('sortTrumpHand', () => {
  it('弱い順（3→A→2→JOKER）にソートされる', () => {
    const hand = [JOKER, c('♠','2'), c('♥','3'), c('♦','A')];
    const sorted = sortTrumpHand(hand);
    expect(sorted[0].v).toBe('3');
    expect(sorted[3].v).toBe('JOKER');
  });

  it('元の配列を変更しない（非破壊）', () => {
    const hand = [JOKER, c('♠','3')];
    const sorted = sortTrumpHand(hand);
    expect(hand[0].v).toBe('JOKER'); // 元配列は変わらない
  });
});