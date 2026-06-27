// ========================================
// uno-logic.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest'; // ✨ Vitest公式パーツ
import { buildUnoDeck, unoCanPlay, unoCardColorClass } from './uno-logic.js';

// ========================================
// buildUnoDeck のテスト
// ========================================
describe('buildUnoDeck', () => {
  it('108枚のデッキを生成する', () => {
    const d = buildUnoDeck();
    expect(d.length).toBe(108);
  });

  it('ワイルドカードが8枚含まれる（W×4 + W4×4）', () => {
    const d = buildUnoDeck();
    const wilds = d.filter(c => c.t === 'w' || c.t === 'w4');
    expect(wilds.length).toBe(8);
  });

  it('各色に0が1枚ずつある', () => {
    const d = buildUnoDeck();
    ['red','blue','green','yellow'].forEach(c => {
      const zeros = d.filter(card => card.c === c && card.v === '0');
      expect(zeros.length).toBe(1);
    });
  });
});

// ========================================
// unoCanPlay のテスト
// ========================================
describe('unoCanPlay', () => {
  // テスト用のカードオブジェクト定義
  const RED5   = { c: 'red',    t: 'num', v: '5' };
  const BLUE5  = { c: 'blue',   t: 'num', v: '5' };
  const BLUE3  = { c: 'blue',   t: 'num', v: '3' };
  const GREEN_SKIP = { c: 'green', t: 'skip', v: '⊘' };
  const RED_SKIP   = { c: 'red',   t: 'skip', v: '⊘' };
  const RED_D2     = { c: 'red',   t: 'd2',   v: '+2' };
  const BLUE_D2    = { c: 'blue',  t: 'd2',   v: '+2' };
  const WILD       = { c: 'w',     t: 'w',    v: 'W'  };
  const WILD4      = { c: 'w',     t: 'w4',   v: '+4' };

  it('同色のカードは出せる', () => {
    expect(unoCanPlay(BLUE3, RED5, 'blue', 0)).toBeTruthy();
  });

  it('同数字のカードは出せる', () => {
    expect(unoCanPlay(BLUE5, RED5, 'red', 0)).toBeTruthy();
  });

  it('色も数字も違う場合は出せない', () => {
    expect(unoCanPlay(BLUE3, RED5, 'red', 0)).toBeFalsy();
  });

  it('ワイルドはどの場面でも出せる', () => {
    expect(unoCanPlay(WILD, RED5, 'red', 0)).toBeTruthy();
    expect(unoCanPlay(WILD, BLUE3, 'green', 0)).toBeTruthy();
  });

  it('ワイルドドロー4はどの場面でも出せる', () => {
    expect(unoCanPlay(WILD4, RED5, 'blue', 0)).toBeTruthy();
  });

  it('同じアクション種別は色が違っても出せる', () => {
    expect(unoCanPlay(GREEN_SKIP, RED_SKIP, 'red', 0)).toBeTruthy();
  });

  it('ペナルティ累積中は +2 に +2 でしか返せない', () => {
    expect(unoCanPlay(BLUE_D2, RED_D2, 'red', 2)).toBeTruthy();
    expect(unoCanPlay(BLUE3,   RED_D2, 'red', 2)).toBeFalsy();
    expect(unoCanPlay(WILD,    RED_D2, 'red', 2)).toBeFalsy();
  });
});

// ========================================
// unoCardColorClass のテスト
// ========================================
describe('unoCardColorClass', () => {
  it('赤カードは "r" を返す', () => {
    expect(unoCardColorClass({ c: 'red', t: 'num', v: '3' })).toBe('r');
  });

  it('ワイルドカードは "w" を返す', () => {
    expect(unoCardColorClass({ c: 'w', t: 'w', v: 'W' })).toBe('w');
    expect(unoCardColorClass({ c: 'w', t: 'w4', v: '+4' })).toBe('w');
  });
});