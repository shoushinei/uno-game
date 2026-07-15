// ========================================
// strategy.ts 単体テスト（ボットの思考ロジック）
// ========================================
import { describe, it, expect } from 'vitest';
import { decideBotPlan, pickBestColor } from './strategy.js';

const T = (s, v) => ({ s, v, id: `${s}${v}` });
const U = (c, t, v) => ({ c, t, v });

function trumpGame(over = {}) {
  return {
    phase: 'trump',
    trumpField: [],
    trumpRevolution: false,
    trumpElevenBack: false,
    trumpSuitLock: null,
    ...over,
  };
}
function unoGame(over = {}) {
  return {
    phase: 'uno',
    unoDiscardPile: [U('red', 'num', '5')],
    unoCurrentColor: 'red',
    unoPenaltyAccum: 0,
    hasParent: null,
    ...over,
  };
}

describe('decideBotPlan — トランプフェイズ', () => {
  it('手札0枚なら trumpSkip', () => {
    expect(decideBotPlan(trumpGame(), [], [], 'p1')).toEqual({ kind: 'trumpSkip' });
  });

  it('場が空なら出せる最初の1枚を trumpPlay', () => {
    const plan = decideBotPlan(trumpGame(), [T('♠', '5'), T('♥', '7')], [], 'p1');
    expect(plan).toEqual({ kind: 'trumpPlay', cardIds: ['♠5'] });
  });

  it('場より弱いカードしか無ければ trumpPass', () => {
    // 場が♠K。手札は♠3のみ（弱い）→出せずパス
    const plan = decideBotPlan(trumpGame({ trumpField: [T('♠', 'K')] }), [T('♠', '3')], [], 'p1');
    expect(plan).toEqual({ kind: 'trumpPass' });
  });

  it('場より強いカードがあれば trumpPlay', () => {
    const plan = decideBotPlan(trumpGame({ trumpField: [T('♠', '5')] }), [T('♥', 'K')], [], 'p1');
    expect(plan).toEqual({ kind: 'trumpPlay', cardIds: ['♥K'] });
  });
});

describe('decideBotPlan — UNOフェイズ', () => {
  it('UNO0枚なら unoSkip', () => {
    expect(decideBotPlan(unoGame(), [], [], 'p1')).toEqual({ kind: 'unoSkip' });
  });

  it('出せる数字カードがあれば unoPlay（手札3枚以上なら sayUnoFirst=false）', () => {
    // 場が赤5。手札は赤3(出せる)＋青9＋緑7 の3枚 → 出しても2枚残るので宣言不要
    const plan = decideBotPlan(unoGame(), [], [U('red', 'num', '3'), U('blue', 'num', '9'), U('green', 'num', '7')], 'p1');
    expect(plan).toEqual({ kind: 'unoPlay', idx: 0, color: null, sayUnoFirst: false });
  });

  it('残り2枚から1枚出すときは sayUnoFirst=true', () => {
    const plan = decideBotPlan(unoGame(), [], [U('red', 'num', '3'), U('red', 'num', '9')], 'p1');
    expect(plan.kind).toBe('unoPlay');
    expect(plan.sayUnoFirst).toBe(true);
  });

  it('ワイルドを出すときは色を選ぶ（残りの手札の多数色）', () => {
    // 手札: ワイルド + 青2枚 + 赤1枚 → ワイルド出す、色は青
    const hand = [U('w', 'w', 'W'), U('blue', 'num', '1'), U('blue', 'num', '2'), U('red', 'num', '3')];
    const plan = decideBotPlan(unoGame({ unoCurrentColor: 'green' }), [], hand, 'p1');
    expect(plan.kind).toBe('unoPlay');
    expect(plan.idx).toBe(0);
    expect(plan.color).toBe('blue');
  });

  it('出せるカードが無ければ unoDraw', () => {
    // 場が赤5、ペナルティ累積中で数字は返せない
    const plan = decideBotPlan(unoGame({ unoPenaltyAccum: 2, unoDiscardPile: [U('red', 'd2', '+2')] }), [], [U('blue', 'num', '3')], 'p1');
    expect(plan).toEqual({ kind: 'unoDraw' });
  });

  it('親の権限があり手札が残っていれば parentColor を最優先', () => {
    const hand = [U('green', 'num', '1'), U('green', 'num', '2'), U('red', 'num', '3')];
    const plan = decideBotPlan(unoGame({ hasParent: 'p1' }), [], hand, 'p1');
    expect(plan).toEqual({ kind: 'parentColor', color: 'green' });
  });

  it('親でも手札0枚なら parentColor ではなく unoSkip', () => {
    const plan = decideBotPlan(unoGame({ hasParent: 'p1' }), [], [], 'p1');
    expect(plan).toEqual({ kind: 'unoSkip' });
  });
});

describe('pickBestColor', () => {
  it('最も多い色を返す', () => {
    expect(pickBestColor([U('red', 'num', '1'), U('blue', 'num', '2'), U('blue', 'num', '3')])).toBe('blue');
  });
  it('ワイルドは色数にカウントしない', () => {
    expect(pickBestColor([U('w', 'w', 'W'), U('red', 'num', '1')])).toBe('red');
  });
  it('全部ワイルドなら先頭色(red)にフォールバック', () => {
    expect(pickBestColor([U('w', 'w', 'W')])).toBe('red');
  });
});

describe('decideBotPlan — 異常系', () => {
  it('g が null なら none', () => {
    expect(decideBotPlan(null, [], [], 'p1')).toEqual({ kind: 'none' });
  });
  it('捨て山が空なら none', () => {
    expect(decideBotPlan(unoGame({ unoDiscardPile: [] }), [], [U('red', 'num', '3')], 'p1')).toEqual({ kind: 'none' });
  });
});
