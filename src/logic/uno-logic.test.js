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
// ========================================
// 追加テスト: バグ修正の回帰テスト + 正常系/異常系
// ========================================
import {
  applyUnoPlay,
  applyUnoDraw,
  drawUnoCards,
  reshuffleUno,
} from './uno-logic.js';

// ---- ゲーム状態ファクトリ ----
function makeGame(overrides = {}) {
  return {
    order: ['p1', 'p2', 'p3'],
    ci: 0,
    dir: 1,
    phase: 'uno',
    rankings: [],
    trumpHands: { p1: [], p2: [], p3: [] },
    unoHands:   { p1: [], p2: [], p3: [] },
    unoDrawPile: [
      { c: 'red',    t: 'num', v: '9' },
      { c: 'blue',   t: 'num', v: '8' },
      { c: 'green',  t: 'num', v: '7' },
      { c: 'yellow', t: 'num', v: '6' },
      { c: 'red',    t: 'num', v: '5' },
      { c: 'blue',   t: 'num', v: '4' },
    ],
    unoDiscardPile: [{ c: 'red', t: 'num', v: '5' }],
    unoCurrentColor: 'red',
    unoPenaltyAccum: 0,
    unoSaid: {},
    ...overrides,
  };
}

// ---- カード定義 ----
const RED5    = { c: 'red',    t: 'num',  v: '5' };
const RED3    = { c: 'red',    t: 'num',  v: '3' };
const BLUE5   = { c: 'blue',  t: 'num',  v: '5' };
const BLUE3   = { c: 'blue',  t: 'num',  v: '3' };
const RED_SKIP = { c: 'red',  t: 'skip', v: '⊘' };
const BLUE_SKIP= { c: 'blue', t: 'skip', v: '⊘' };
const RED_REV  = { c: 'red',  t: 'rev',  v: '⇄' };
const RED_D2   = { c: 'red',  t: 'd2',   v: '+2' };
const BLUE_D2  = { c: 'blue', t: 'd2',   v: '+2' };
const WILD     = { c: 'w',    t: 'w',    v: 'W'  };
const WILD4    = { c: 'w',    t: 'w4',   v: '+4' };

// ========================================
// buildUnoDeck 追加テスト
// ========================================
describe('buildUnoDeck 詳細', () => {
  it('[正常] 各色に 1〜9 が2枚ずつある', () => {
    const d = buildUnoDeck();
    ['red', 'blue', 'green', 'yellow'].forEach(color => {
      for (let n = 1; n <= 9; n++) {
        const count = d.filter(c => c.c === color && c.v === String(n)).length;
        expect(count).toBe(2);
      }
    });
  });

  it('[正常] 各色に skip/rev/+2 が2枚ずつある', () => {
    const d = buildUnoDeck();
    ['red', 'blue', 'green', 'yellow'].forEach(color => {
      ['skip', 'rev', 'd2'].forEach(type => {
        const count = d.filter(c => c.c === color && c.t === type).length;
        expect(count).toBe(2);
      });
    });
  });

  it('[正常] ワイルドが4枚、ワイルドドロー4が4枚ある', () => {
    const d = buildUnoDeck();
    expect(d.filter(c => c.t === 'w').length).toBe(4);
    expect(d.filter(c => c.t === 'w4').length).toBe(4);
  });
});

// ========================================
// unoCanPlay 追加テスト
// ========================================
describe('unoCanPlay 追加パターン', () => {
  it('[正常] ワイルドで指定した色と同じ色のアクションカードは出せる', () => {
    // ワイルドが場にある、currentColor='blue'
    expect(unoCanPlay(BLUE_SKIP, WILD, 'blue', 0)).toBeTruthy();
    expect(unoCanPlay(BLUE_D2,  WILD, 'blue', 0)).toBeTruthy();
    expect(unoCanPlay({ c:'blue', t:'rev', v:'⇄' }, WILD, 'blue', 0)).toBeTruthy();
  });

  it('[正常] ワイルド+4で指定した色と同じ色の数字カードは出せる（ペナルティなし）', () => {
    expect(unoCanPlay(BLUE3, WILD4, 'blue', 0)).toBeTruthy();
  });

  it('[異常] ワイルドで指定した色と違う色のアクションカードは出せない', () => {
    // currentColor='blue' なのに red_skip を出そうとする
    expect(unoCanPlay(RED_SKIP, WILD, 'blue', 0)).toBeFalsy();
  });

  it('[正常] +2 が場にある（ペナルティなし）のとき、同色の数字が出せる', () => {
    expect(unoCanPlay(RED3, RED_D2, 'red', 0)).toBeTruthy();
  });

  it('[異常] +2 ペナルティ累積中は数字カードは出せない', () => {
    expect(unoCanPlay(RED3, RED_D2, 'red', 2)).toBeFalsy();
  });

  it('[異常] +2 ペナルティ累積中はワイルドも出せない（本ゲームルール）', () => {
    expect(unoCanPlay(WILD,  RED_D2, 'red', 2)).toBeFalsy();
    expect(unoCanPlay(WILD4, RED_D2, 'red', 2)).toBeFalsy();
  });

  it('[正常] +4 ペナルティ累積中は +4 でしか返せない', () => {
    expect(unoCanPlay(WILD4, WILD4, 'blue', 4)).toBeTruthy();
    expect(unoCanPlay(WILD,  WILD4, 'blue', 4)).toBeFalsy();
    expect(unoCanPlay(BLUE3, WILD4, 'blue', 4)).toBeFalsy();
  });

  it('[正常] 異なるアクション種別でも同色なら出せる', () => {
    // 場が red_skip で currentColor='red'、手持ちが red_rev
    const RED_REV2 = { c: 'red', t: 'rev', v: '⇄' };
    expect(unoCanPlay(RED_REV2, RED_SKIP, 'red', 0)).toBeTruthy();
  });

  it('[正常] 数字が同じなら色違いでも出せる', () => {
    // 場が red_5, currentColor='red', 手持ちが blue_5
    expect(unoCanPlay(BLUE5, RED5, 'red', 0)).toBeTruthy();
  });

  it('[異常] アクションカード同士でも種別が違い色も違うなら出せない', () => {
    // 場が red_skip, currentColor='red', 手持ちが blue_d2
    expect(unoCanPlay(BLUE_D2, RED_SKIP, 'red', 0)).toBeFalsy();
  });
});

// ========================================
// applyUnoPlay のテスト
// ========================================
describe('applyUnoPlay', () => {

  // ---- 正常系 ----
  it('[正常] カードを出すと手札が1枚減る', () => {
    // 3枚持たせて1枚出す → 残り2枚（UNO忘れペナルティの対象外にする）
    const g = makeGame({ unoHands: { p1: [RED5, BLUE3, RED3], p2: [], p3: [] } });
    const result = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(result).not.toBeNull();
    expect(result.g.unoHands['p1'].length).toBe(2);
  });

  it('[正常] カードを出すと捨て山に積まれる', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    const prevLen = g.unoDiscardPile.length;
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoDiscardPile.length).toBe(prevLen + 1);
  });

  it('[正常] 数字カードを出すと unoCurrentColor がそのカードの色になる', () => {
    const g = makeGame({ unoHands: { p1: [BLUE5], p2: [], p3: [] }, unoCurrentColor: 'red' });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoCurrentColor).toBe('blue');
  });

  it('[正常] フェイズが trump に戻る', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    const result = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(result.g.phase).toBe('trump');
  });

  it('[正常] logMsg にプレイヤー名とカードの値が含まれる', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    const result = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(result.logMsg).toContain('Alice');
    expect(result.logMsg).toContain('5');
  });

  it('[正常] ターンが次のプレイヤーに移る（dir=1 なら ci が進む）', () => {
    // p1 のトランプ手札を残しておき、あがり判定でorderから消えないようにする
    const g = makeGame({
      trumpHands: { p1: [{ s: '♠', v: '5', id: '♠5' }], p2: [], p3: [] },
      unoHands: { p1: [RED5, RED3], p2: [BLUE3], p3: [RED3] },
      ci: 0,
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.ci).toBe(1); // p1(0) → p2(1)
  });

  // ---- スキップ ----
  it('[正常] スキップカードを出すと次のプレイヤーが飛ばされる', () => {
    const g = makeGame({
      trumpHands: { p1: [{ s: '♠', v: '5', id: '♠5' }], p2: [], p3: [] },
      unoHands: { p1: [RED_SKIP, RED3], p2: [BLUE3], p3: [RED3] },
      unoDiscardPile: [RED5],
      unoCurrentColor: 'red',
      ci: 0,
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.ci).toBe(2); // p2 がスキップされて p3(2)
  });

  it('[正常] スキップのログに スキップ！ が含まれる', () => {
    const g = makeGame({ unoHands: { p1: [RED_SKIP], p2: [], p3: [] }, unoDiscardPile: [RED5], unoCurrentColor: 'red' });
    const result = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(result.logMsg).toContain('スキップ');
  });

  // ---- リバース ----
  it('[正常] リバースカードを出すと dir が反転する', () => {
    const g = makeGame({
      unoHands: { p1: [RED_REV], p2: [], p3: [] },
      unoDiscardPile: [RED5],
      unoCurrentColor: 'red',
      dir: 1,
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.dir).toBe(-1);
  });

  // ---- +2 ----
  it('[正常] +2 を出すと unoPenaltyAccum が 2 増える', () => {
    const g = makeGame({ unoHands: { p1: [RED_D2], p2: [], p3: [] }, unoDiscardPile: [RED5], unoCurrentColor: 'red' });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoPenaltyAccum).toBe(2);
  });

  it('[正常] +2 を連続で出すと累積される', () => {
    const g = makeGame({
      unoHands: { p1: [RED_D2], p2: [BLUE_D2], p3: [] },
      unoDiscardPile: [RED5],
      unoCurrentColor: 'red',
      ci: 0,
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    // p2 のターンで青+2（赤+2の上に出せる: card.t===top.t）
    g.unoDiscardPile[g.unoDiscardPile.length - 1]; // 場の確認
    applyUnoPlay(g, 'p2', 0, null, 'Bob');
    expect(g.unoPenaltyAccum).toBe(4);
  });

  it('[正常] +2 を出すと penaltyAccum はリセットしない', () => {
    const g = makeGame({ unoHands: { p1: [RED_D2], p2: [], p3: [] }, unoDiscardPile: [RED5], unoCurrentColor: 'red', unoPenaltyAccum: 0 });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoPenaltyAccum).toBe(2); // 0 ではなく 2 になっている
  });

  it('[正常] 数字カードを出すと penaltyAccum が 0 にリセットされる', () => {
    const g = makeGame({
      unoHands: { p1: [RED5], p2: [], p3: [] },
      unoCurrentColor: 'red',
      unoPenaltyAccum: 0, // テスト上 0 にして通常カード出しを確認
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoPenaltyAccum).toBe(0);
  });

  // ---- ワイルド ----
  it('[正常] ワイルドを出すと chosenColor が unoCurrentColor になる', () => {
    const g = makeGame({ unoHands: { p1: [WILD], p2: [], p3: [] }, unoCurrentColor: 'red' });
    applyUnoPlay(g, 'p1', 0, 'blue', 'Alice');
    expect(g.unoCurrentColor).toBe('blue');
  });

  it('[正常] ワイルド+4 を出すと unoPenaltyAccum が 4 増える', () => {
    const g = makeGame({ unoHands: { p1: [WILD4], p2: [], p3: [] }, unoCurrentColor: 'red' });
    applyUnoPlay(g, 'p1', 0, 'green', 'Alice');
    expect(g.unoPenaltyAccum).toBe(4);
    expect(g.unoCurrentColor).toBe('green');
  });

  // ---- ★バグ修正回帰テスト★ ----
  it('[バグ修正] ワイルドに chosenColor=null を渡しても現在の色が維持される', () => {
    const g = makeGame({
      unoHands: { p1: [WILD], p2: [], p3: [] },
      unoCurrentColor: 'blue', // 既にblueが設定されている
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice'); // null を渡す
    // chosenColor が null なら現在の色('blue')を維持する
    expect(g.unoCurrentColor).toBe('blue'); // 'red' に壊れないことを確認
  });

  it('[バグ修正] ワイルド+4 に chosenColor=null を渡しても現在の色が維持される', () => {
    const g = makeGame({
      unoHands: { p1: [WILD4], p2: [], p3: [] },
      unoCurrentColor: 'green',
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoCurrentColor).toBe('green'); // 'red' に壊れない
  });

  // ---- UNO忘れペナルティ ----
  it('[正常] 手札が残り1枚になったのに UNO宣言していなければ 2枚引かされる', () => {
    // 手札2枚 → 1枚出す → 残り1枚 → UNO未宣言 → 2枚引かされる → 合計3枚
    const g = makeGame({
      unoHands: { p1: [RED5, RED3], p2: [], p3: [] },
      unoSaid: {}, // 未宣言
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoHands['p1'].length).toBe(3); // 1 + 2 = 3枚
  });

  it('[正常] UNO宣言済みなら 1枚残っても 2枚引かされない', () => {
    const g = makeGame({
      unoHands: { p1: [RED5, RED3], p2: [], p3: [] },
      unoSaid: { p1: true }, // 宣言済み
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoHands['p1'].length).toBe(1); // 1枚のまま
  });

  // ---- あがり判定 ----
  it('[正常] トランプもUNOも0枚になったプレイヤーはランキングに追加され order から除外される', () => {
    const g = makeGame({
      order: ['p1', 'p2', 'p3'],
      trumpHands: { p1: [], p2: [{ s:'♠', v:'5', id:'♠5' }], p3: [{ s:'♥', v:'3', id:'♥3' }] },
      unoHands: { p1: [RED5], p2: [BLUE3], p3: [RED3] },
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.rankings[0]?.id).toBe('p1');
    expect(g.order).not.toContain('p1');
  });

  it('[正常] トランプが残っている場合はあがりにならない', () => {
    const g = makeGame({
      trumpHands: { p1: [{ s:'♠', v:'5', id:'♠5' }], p2: [], p3: [] },
      unoHands: { p1: [RED5], p2: [], p3: [] },
    });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.rankings.length).toBe(0);
    expect(g.order).toContain('p1');
  });

  it('[正常] 残りプレイヤーが1人以下になると isGameOver=true', () => {
    const g = makeGame({
      order: ['p1', 'p2'],
      trumpHands: { p1: [], p2: [] },
      unoHands:   { p1: [RED5], p2: [BLUE3] },
    });
    // p1 が出し切る
    const result = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(result.isGameOver).toBe(true);
  });

  // ---- 異常系 ----
  it('[異常] 存在しないインデックスのカードを出そうとすると null を返す', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    expect(applyUnoPlay(g, 'p1', 5, null, 'Alice')).toBeNull();
  });

  it('[異常] 出せないカード（色も数字も不一致）を出そうとすると null を返す', () => {
    const g = makeGame({
      unoHands: { p1: [BLUE3], p2: [], p3: [] },
      unoDiscardPile: [RED5],
      unoCurrentColor: 'red',
    });
    expect(applyUnoPlay(g, 'p1', 0, null, 'Alice')).toBeNull();
  });

  it('[異常] ペナルティ累積中に+2/+4以外のカードは出せない', () => {
    const g = makeGame({
      unoHands: { p1: [RED5], p2: [], p3: [] },
      unoDiscardPile: [RED_D2],
      unoCurrentColor: 'red',
      unoPenaltyAccum: 2,
    });
    expect(applyUnoPlay(g, 'p1', 0, null, 'Alice')).toBeNull();
  });
});

// ========================================
// applyUnoDraw のテスト
// ========================================
describe('applyUnoDraw', () => {

  it('[正常] 通常ドローで手札が1枚増える', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoHands['p1'].length).toBe(2);
  });

  it('[正常] 通常ドローのログに「1枚引いた」が含まれる', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    const { logMsg } = applyUnoDraw(g, 'p1', 'Alice');
    expect(logMsg).toContain('1枚');
    expect(logMsg).toContain('Alice');
  });

  it('[正常] ペナルティ累積中のドローで累積枚数引いて unoPenaltyAccum が 0 になる', () => {
    const g = makeGame({
      unoHands: { p1: [], p2: [], p3: [] },
      unoPenaltyAccum: 4,
    });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoHands['p1'].length).toBe(4);
    expect(g.unoPenaltyAccum).toBe(0);
  });

  it('[正常] ペナルティドローのログに枚数が含まれる', () => {
    const g = makeGame({ unoHands: { p1: [], p2: [], p3: [] }, unoPenaltyAccum: 2 });
    const { logMsg } = applyUnoDraw(g, 'p1', 'Alice');
    expect(logMsg).toContain('2枚');
    expect(logMsg).toContain('ペナルティ');
  });

  it('[正常] ドロー後は phase が trump になる', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] } });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.phase).toBe('trump');
  });

  it('[正常] ドロー後はターンが次のプレイヤーに移る', () => {
    const g = makeGame({ unoHands: { p1: [RED5], p2: [], p3: [] }, ci: 0 });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.ci).toBe(1);
  });

  // ★バグ修正回帰テスト★
  // UNO宣言後にカードを引くと手札が増えて「残り1枚になる」状況ではなくなるのに、
  // 以前は宣言状態(unoSaid)が残り続けていた（📢UNOバッジが出っぱなしになり、
  // 次に2枚→1枚を出すときにも宣言不要になってしまう）。
  it('[バグ修正] UNO宣言後にカードを引くと宣言状態がリセットされる', () => {
    const g = makeGame({
      unoHands: { p1: [RED5, RED3], p2: [], p3: [] },
      unoSaid: { p1: true },
    });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoSaid.p1).toBeUndefined();
  });

  it('[バグ修正] 他のプレイヤーの宣言状態は引いても消えない', () => {
    const g = makeGame({
      unoHands: { p1: [RED5, RED3], p2: [BLUE3], p3: [] },
      unoSaid: { p2: true },
    });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoSaid.p2).toBe(true);
  });
});

// ========================================
// reshuffleUno のテスト
// ========================================
describe('reshuffleUno', () => {
  it('[正常] 捨て山の最後のカードだけが残り、残りはドロー山に移る', () => {
    const topCard = { c: 'red', t: 'num', v: '9' };
    const g = makeGame({
      unoDrawPile: [],
      unoDiscardPile: [
        { c: 'blue', t: 'num', v: '3' },
        { c: 'green', t: 'num', v: '5' },
        topCard,
      ],
    });
    reshuffleUno(g);
    expect(g.unoDiscardPile).toEqual([topCard]); // 最後の1枚だけ残る
    expect(g.unoDrawPile.length).toBe(2);         // 残りがドロー山へ
  });

  it('[異常] 捨て山が空でも reshuffleUno はクラッシュしない', () => {
    const g = makeGame({ unoDrawPile: [], unoDiscardPile: [] });
    expect(() => reshuffleUno(g)).not.toThrow();
  });
});

// ========================================
// drawUnoCards のテスト
// ========================================
describe('drawUnoCards', () => {
  it('[正常] 指定枚数分手札に追加される', () => {
    const g = makeGame({ unoHands: { p1: [], p2: [], p3: [] } });
    drawUnoCards(g, 'p1', 3);
    expect(g.unoHands['p1'].length).toBe(3);
  });

  it('[正常] 山札が切れたとき捨て山から補充して引ける', () => {
    // 山札1枚 + 捨て山(top以外2枚)が再シャッフル後の山札になる
    // 合計 1 + 2 = 3枚引けるだけのカードが用意されている
    const g = makeGame({
      unoHands: { p1: [], p2: [], p3: [] },
      unoDrawPile: [{ c: 'red', t: 'num', v: '1' }], // 山札1枚
      unoDiscardPile: [
        { c: 'blue',  t: 'num', v: '2' },
        { c: 'yellow', t: 'num', v: '4' },
        { c: 'green', t: 'num', v: '3' }, // top（再シャッフル後も捨て山に残る）
      ],
    });
    drawUnoCards(g, 'p1', 3); // 山札1枚 + 再シャッフルで2枚補充 → 合計3枚引ける
    expect(g.unoHands['p1'].length).toBe(3);
  });

  it('[異常] 山札も捨て山も尽きたら、それ以上は引けない', () => {
    const g = makeGame({
      unoHands: { p1: [], p2: [], p3: [] },
      unoDrawPile: [{ c: 'red', t: 'num', v: '1' }], // 山札1枚のみ
      unoDiscardPile: [{ c: 'green', t: 'num', v: '3' }], // top1枚のみ（再シャッフル材料なし）
    });
    drawUnoCards(g, 'p1', 5); // 5枚要求しても引けるのは1枚だけ
    expect(g.unoHands['p1'].length).toBe(1);
  });
});

// ========================================
// ★バグ2 回帰テスト★
// resetUnoSelection() が pendingUnoIdx まで消してしまい、色ピッカー確定時に
// actionUnoPlay(null, color) が呼ばれてワイルドカードが出せなくなっていた不具合。
// ui-input.js 側の修正（pendingUnoIdx とselectedUnoIdxの分離）と対になる、
// ロジック層（applyUnoPlay）での症状再現テスト。
// ========================================
describe('applyUnoPlay — バグ2回帰（cardIdx が null だと出せない症状の確認）', () => {
  it('[バグ2の症状] ワイルドカードでも cardIdx が null なら出せない（null を返す）', () => {
    const g = makeGame({ unoHands: { p1: [WILD], p2: [], p3: [] }, unoCurrentColor: 'red' });
    // pendingUnoIdx が誤って失われたケースをシミュレート（idx=null で呼ばれる）
    const result = applyUnoPlay(g, 'p1', null, 'blue', 'Alice');
    expect(result).toBeNull();
    expect(g.unoHands['p1'].length).toBe(1); // 手札はそのまま（出せていない）
  });

  it('[修正確認] pendingUnoIdx が正しく保持されていれば（idx=0）ワイルドカードは正常に出せる', () => {
    const g = makeGame({ unoHands: { p1: [WILD], p2: [], p3: [] }, unoCurrentColor: 'red' });
    const result = applyUnoPlay(g, 'p1', 0, 'blue', 'Alice');
    expect(result).not.toBeNull();
    expect(result.g.unoCurrentColor).toBe('blue');
    expect(result.g.unoHands['p1'].length).toBe(0);
  });
});
