// ========================================
// uno-logic.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest'; 
import {
  buildUnoDeck,
  unoCanPlay,
  unoCardColorClass,
  drawUnoCards,
  applyUnoPlay,
  applyUnoDraw,
} from './uno-logic.js';

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
// buildUnoDeck 追加テスト（正常系）
// ========================================
describe('buildUnoDeck — 追加（正常系）', () => {
  it('各色の1〜9は2枚ずつある（4色 × 9種 × 2枚 = 72枚）', () => {
    const d = buildUnoDeck();
    ['red', 'blue', 'green', 'yellow'].forEach(c => {
      for (let n = 1; n <= 9; n++) {
        const cards = d.filter(card => card.c === c && card.v === String(n));
        expect(cards.length).toBe(2);
      }
    });
  });

  it('各色のスキップ・リバース・+2 はそれぞれ2枚ずつある', () => {
    const d = buildUnoDeck();
    ['red', 'blue', 'green', 'yellow'].forEach(c => {
      expect(d.filter(card => card.c === c && card.t === 'skip').length).toBe(2);
      expect(d.filter(card => card.c === c && card.t === 'rev').length).toBe(2);
      expect(d.filter(card => card.c === c && card.t === 'd2').length).toBe(2);
    });
  });

  it('ワイルド（W）は4枚ある', () => {
    const d = buildUnoDeck();
    expect(d.filter(c => c.t === 'w').length).toBe(4);
  });

  it('ワイルドドロー4（+4）は4枚ある', () => {
    const d = buildUnoDeck();
    expect(d.filter(c => c.t === 'w4').length).toBe(4);
  });

  it('全カードが c / t / v プロパティを持つ', () => {
    const d = buildUnoDeck();
    d.forEach(card => {
      expect(card).toHaveProperty('c');
      expect(card).toHaveProperty('t');
      expect(card).toHaveProperty('v');
    });
  });
});

// ========================================
// unoCanPlay 追加テスト（正常系）
// ========================================
describe('unoCanPlay — 追加（正常系）', () => {
  const RED5    = { c: 'red',    t: 'num',  v: '5'  };
  const RED_D2  = { c: 'red',   t: 'd2',   v: '+2' };
  const BLUE_D2 = { c: 'blue',  t: 'd2',   v: '+2' };
  const WILD4   = { c: 'w',     t: 'w4',   v: '+4' };
  const BLUE_W4 = { c: 'w',     t: 'w4',   v: '+4' };

  it('currentColor に一致する色なら数字が違っても出せる', () => {
    const BLUE7 = { c: 'blue', t: 'num', v: '7' };
    const TOP   = { c: 'red',  t: 'num', v: '3' };
    expect(unoCanPlay(BLUE7, TOP, 'blue', 0)).toBeTruthy();
  });

  it('ワイルド直後に chosenColor と同色なら出せる', () => {
    const WILD = { c: 'w', t: 'w', v: 'W' };
    const GREEN3 = { c: 'green', t: 'num', v: '3' };
    // currentColor が green に変わった後の場面
    expect(unoCanPlay(GREEN3, WILD, 'green', 0)).toBeTruthy();
  });

  it('ペナルティ累積中は +4 に +4 でしか返せない', () => {
    expect(unoCanPlay(BLUE_W4, WILD4, 'red', 4)).toBeTruthy();
    expect(unoCanPlay(RED5,    WILD4, 'red', 4)).toBeFalsy();
  });

  it('+2 累積中に +4 で返すことはできない（異種スタック禁止）', () => {
    expect(unoCanPlay(WILD4, RED_D2, 'red', 2)).toBeFalsy();
  });

  it('+4 累積中に +2 で返すことはできない（異種スタック禁止）', () => {
    expect(unoCanPlay(BLUE_D2, WILD4, 'red', 4)).toBeFalsy();
  });
});

// ========================================
// unoCanPlay 追加テスト（異常系）
// ========================================
describe('unoCanPlay — 追加（異常系）', () => {
  const RED5  = { c: 'red',  t: 'num', v: '5' };
  const BLUE3 = { c: 'blue', t: 'num', v: '3' };

  it('penaltyAccum が 0 の場合でも色・数字・種別すべて不一致なら false', () => {
    expect(unoCanPlay(BLUE3, RED5, 'red', 0)).toBeFalsy();
  });

  it('penaltyAccum が負数（異常値）でも通常ルールで判定される', () => {
    // 負数は penaltyAccum > 0 に引っかからないので通常判定になる
    expect(unoCanPlay(BLUE3, RED5, 'blue', -1)).toBeTruthy(); // 同色なので出せる
  });
});

// ========================================
// unoCardColorClass 追加テスト（正常系・異常系）
// ========================================
describe('unoCardColorClass — 追加', () => {
  it('青カードは "b" を返す', () => {
    expect(unoCardColorClass({ c: 'blue',   t: 'num', v: '1' })).toBe('b');
  });

  it('緑カードは "g" を返す', () => {
    expect(unoCardColorClass({ c: 'green',  t: 'skip', v: '⊘' })).toBe('g');
  });

  it('黄カードは "y" を返す', () => {
    expect(unoCardColorClass({ c: 'yellow', t: 'rev', v: '⇄' })).toBe('y');
  });

  it('アクションカード（d2）も色の先頭文字を返す', () => {
    expect(unoCardColorClass({ c: 'red', t: 'd2', v: '+2' })).toBe('r');
  });
});

// ========================================
// drawUnoCards のテスト（正常系・異常系）
// ========================================
describe('drawUnoCards', () => {
  function makeDrawGame(drawPile, hand = []) {
    return {
      unoDrawPile:    [...drawPile],
      unoDiscardPile: [{ c: 'red', t: 'num', v: '1' }], // reshuffleUno 用に1枚だけ
      unoHands:       { p1: [...hand] },
    };
  }

  it('（正常系）1枚引くと手札が1枚増える', () => {
    const g = makeDrawGame([
      { c: 'blue', t: 'num', v: '3' },
    ]);
    drawUnoCards(g, 'p1', 1);
    expect(g.unoHands['p1'].length).toBe(1);
    expect(g.unoDrawPile.length).toBe(0);
  });

  it('（正常系）複数枚引くと指定枚数だけ手札が増える', () => {
    const g = makeDrawGame([
      { c: 'blue', t: 'num', v: '2' },
      { c: 'green', t: 'num', v: '4' },
      { c: 'yellow', t: 'num', v: '6' },
    ]);
    drawUnoCards(g, 'p1', 3);
    expect(g.unoHands['p1'].length).toBe(3);
  });

  it('（正常系）既存の手札に追記される', () => {
    const g = makeDrawGame(
      [{ c: 'red', t: 'num', v: '9' }],
      [{ c: 'blue', t: 'num', v: '1' }]
    );
    drawUnoCards(g, 'p1', 1);
    expect(g.unoHands['p1'].length).toBe(2);
  });

  it('（正常系）山札が切れたら捨て山を再利用して補充する（reshuffleUno）', () => {
    // 山札は空、捨て山に3枚ある（上1枚は保持される）
    const g = {
      unoDrawPile: [],
      unoDiscardPile: [
        { c: 'red',   t: 'num', v: '1' },
        { c: 'blue',  t: 'num', v: '2' },
        { c: 'green', t: 'num', v: '3' }, // ← 一番上（保持される）
      ],
      unoHands: { p1: [] },
    };
    drawUnoCards(g, 'p1', 1);
    // 手札が1枚増えていること
    expect(g.unoHands['p1'].length).toBe(1);
    // 捨て山の一番上だけが残っていること
    expect(g.unoDiscardPile.length).toBe(1);
  });

  it('（異常系）山札も捨て山も空なら手札は増えない', () => {
    const g = {
      unoDrawPile: [],
      unoDiscardPile: [], // reshuffleUno しても top が undefined になり何も補充されない
      unoHands: { p1: [] },
    };
    // エラーにはならず、手札が増えないことを確認
    expect(() => drawUnoCards(g, 'p1', 1)).not.toThrow();
    expect(g.unoHands['p1'].length).toBe(0);
  });

  it('（異常系）count=0 を渡しても手札・山札に変化なし', () => {
    const g = makeDrawGame([{ c: 'red', t: 'num', v: '5' }]);
    drawUnoCards(g, 'p1', 0);
    expect(g.unoHands['p1'].length).toBe(0);
    expect(g.unoDrawPile.length).toBe(1);
  });
});

// ========================================
// applyUnoPlay のテスト（正常系・異常系）
// ========================================
describe('applyUnoPlay', () => {
  function makePlayGame(hand, discardTop, overrides = {}) {
    return {
      order:          ['p1', 'p2', 'p3'],
      ci:             0,
      dir:            1,
      phase:          'uno',
      unoHands:       { p1: [...hand], p2: [{}], p3: [{}] },
      trumpHands:     { p1: [{}], p2: [{}], p3: [{}] }, // トランプ残あり
      unoDiscardPile: [discardTop],
      unoDrawPile:    [{ c: 'yellow', t: 'num', v: '9' }, { c: 'yellow', t: 'num', v: '8' }],
      unoCurrentColor:'red',
      unoPenaltyAccum: 0,
      rankings:       [],
      unoSaid:        {},
      ...overrides,
    };
  }

  const RED5    = { c: 'red',   t: 'num',  v: '5'  };
  const RED3    = { c: 'red',   t: 'num',  v: '3'  };
  const BLUE5   = { c: 'blue',  t: 'num',  v: '5'  };
  const RED_SKIP= { c: 'red',   t: 'skip', v: '⊘'  };
  const RED_REV = { c: 'red',   t: 'rev',  v: '⇄'  };
  const RED_D2  = { c: 'red',   t: 'd2',   v: '+2' };
  const WILD    = { c: 'w',     t: 'w',    v: 'W'  };
  const WILD4   = { c: 'w',     t: 'w4',   v: '+4' };

  // ---- 正常系 ----

  it('（正常系）通常カードを出すと手札が1枚減る', () => {
    // 手札3枚にして1枚出す → 残り2枚（残り1枚にならないのでUNO忘れペナルティが発動しない）
    const RED7 = { c: 'red', t: 'num', v: '7' };
    const g = makePlayGame([RED5, RED3, RED7], RED3);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoHands['p1'].length).toBe(2);
  });

  it('（正常系）カードを出すと捨て山の一番上が更新される', () => {
    const g = makePlayGame([RED5], RED3);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoDiscardPile[g.unoDiscardPile.length - 1]).toEqual(RED5);
  });

  it('（正常系）通常カードを出すと現在の色が出したカードの色になる', () => {
    const g = makePlayGame([BLUE5], RED5);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoCurrentColor).toBe('blue');
  });

  it('（正常系）スキップを出すと次の次のプレイヤーに手番が移る（p1→p3）', () => {
    const g = makePlayGame([RED_SKIP, RED3], RED5);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    // order=['p1','p2','p3'], p1がスキップ → p2を飛ばして p3(index=2)
    expect(g.ci).toBe(2);
  });

  it('（正常系）リバースを出すと手番の方向が反転する', () => {
    const g = makePlayGame([RED_REV], RED5);
    expect(g.dir).toBe(1);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.dir).toBe(-1);
  });

  it('（正常系）+2 を出すと unoPenaltyAccum が2増える', () => {
    const g = makePlayGame([RED_D2], RED5);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoPenaltyAccum).toBe(2);
  });

  it('（正常系）ワイルドを出すと chosenColor に色が変わる', () => {
    const g = makePlayGame([WILD], RED5);
    applyUnoPlay(g, 'p1', 0, 'green', 'Alice');
    expect(g.unoCurrentColor).toBe('green');
  });

  it('（正常系）ワイルド+4 を出すと unoPenaltyAccum が4増える', () => {
    const g = makePlayGame([WILD4], RED5);
    applyUnoPlay(g, 'p1', 0, 'blue', 'Alice');
    expect(g.unoPenaltyAccum).toBe(4);
  });

  it('（正常系）+2 を出した後フェイズが trump に戻る', () => {
    const g = makePlayGame([RED_D2], RED5);
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.phase).toBe('trump');
  });

  it('（正常系）UNO忘れ：出した後に手札が1枚になった場合 2枚引くペナルティ', () => {
    // 手札2枚の状態で1枚出す → 残り1枚 → UNO宣言なし → 2枚引く（合計3枚になる）
    const g = makePlayGame([RED5, RED3], RED3, { unoSaid: {} });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoHands['p1'].length).toBe(3); // 残1枚 + ペナルティ2枚
  });

  it('（正常系）UNO宣言済みなら 1枚になってもペナルティなし', () => {
    const g = makePlayGame([RED5, RED3], RED3, { unoSaid: { p1: true } });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoHands['p1'].length).toBe(1);
  });

  it('（正常系）両方0枚になったらランキングに登録され order から除外される', () => {
    // trumpHands も空にする
    const g = makePlayGame([RED5], RED3, {
      trumpHands: { p1: [], p2: [{}], p3: [{}] },
    });
    const r = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.rankings.some(rk => rk.id === 'p1')).toBeTruthy();
    expect(g.order.includes('p1')).toBeFalsy();
    expect(r.isGameOver).toBeFalsy(); // まだ2人残っている
  });

  it('（正常系）残り1人になったら isGameOver=true', () => {
    // p2,p3 はすでに rankings に存在し、p1 が上がると order が空に近い
    const g = makePlayGame([RED5], RED3, {
      order:      ['p1', 'p2'],
      unoHands:   { p1: [RED5], p2: [] },
      trumpHands: { p1: [],     p2: [] },
      rankings:   [{ id: 'p3', name: 'Carol' }],
    });
    const r = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(r.isGameOver).toBeTruthy();
  });

  it('（正常系）+2 累積2枚の状態で +2 を出すと累積が4になる', () => {
    const g = makePlayGame([RED_D2], RED_D2, { unoPenaltyAccum: 2 });
    applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(g.unoPenaltyAccum).toBe(4);
  });

  // ---- 異常系 ----

  it('（異常系）存在しないインデックスを渡すと null を返す', () => {
    const g = makePlayGame([RED5], RED3);
    const r = applyUnoPlay(g, 'p1', 99, null, 'Alice');
    expect(r).toBeNull();
  });

  it('（異常系）出せないカードを渡すと null を返す', () => {
    // 場が RED5、手持ちは BLUE5 以外のカード（色も数字も不一致）
    const BLUE3 = { c: 'blue', t: 'num', v: '3' };
    const g = makePlayGame([BLUE3], RED5); // currentColor='red', topCard=RED5
    const r = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(r).toBeNull();
  });

  it('（異常系）ペナルティ累積中に通常カードを出そうとすると null を返す', () => {
    const g = makePlayGame([RED5], RED_D2, { unoPenaltyAccum: 2 });
    const r = applyUnoPlay(g, 'p1', 0, null, 'Alice');
    expect(r).toBeNull();
  });
});

// ========================================
// applyUnoDraw のテスト（正常系・異常系）
// ========================================
describe('applyUnoDraw', () => {
  function makeDrawGame(overrides = {}) {
    return {
      order:           ['p1', 'p2', 'p3'],
      ci:              0,
      dir:             1,
      phase:           'uno',
      unoHands:        { p1: [], p2: [], p3: [] }, // drawUnoCards が参照するため必須
      unoDrawPile:     [
        { c: 'blue', t: 'num', v: '1' },
        { c: 'blue', t: 'num', v: '2' },
        { c: 'blue', t: 'num', v: '3' },
        { c: 'blue', t: 'num', v: '4' },
        { c: 'blue', t: 'num', v: '5' },
      ],
      unoDiscardPile:  [{ c: 'red', t: 'num', v: '9' }],
      unoPenaltyAccum: 0,
      ...overrides,
    };
  }

  it('（正常系）通常時は1枚だけ引く', () => {
    const g = makeDrawGame();
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoHands['p1'].length).toBe(1);
  });

  it('（正常系）1枚引いた後フェイズが trump に戻る', () => {
    const g = makeDrawGame();
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.phase).toBe('trump');
  });

  it('（正常系）1枚引いた後 ci が次のプレイヤーに進む（p1→p2）', () => {
    const g = makeDrawGame({ ci: 0 });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.ci).toBe(1); // order=['p1','p2','p3'], dir=1 なので次は index=1
  });

  it('（正常系）ペナルティ累積中は累積枚数をまとめて引き、0にリセットされる', () => {
    const g = makeDrawGame({ unoPenaltyAccum: 4 });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.unoHands['p1'].length).toBe(4);
    expect(g.unoPenaltyAccum).toBe(0);
  });

  it('（正常系）ペナルティ引き後もフェイズが trump に戻る（手番継続ではなくフェイズが次へ）', () => {
    const g = makeDrawGame({ unoPenaltyAccum: 2 });
    applyUnoDraw(g, 'p1', 'Alice');
    expect(g.phase).toBe('trump');
  });

  it('（正常系）logMsg に名前が含まれる', () => {
    const g = makeDrawGame();
    const { logMsg } = applyUnoDraw(g, 'p1', 'Alice');
    expect(logMsg).toContain('Alice');
  });

  it('（正常系）ペナルティ引きの logMsg に枚数が含まれる', () => {
    const g = makeDrawGame({ unoPenaltyAccum: 4 });
    const { logMsg } = applyUnoDraw(g, 'p1', 'Alice');
    expect(logMsg).toContain('4');
  });

  it('（異常系）order に存在しない playerId を渡しても ci は変化しない', () => {
    const g = makeDrawGame({ ci: 0 });
    applyUnoDraw(g, 'unknown', 'Ghost');
    // myIdx = -1 になるため ci はそのまま
    expect(g.ci).toBe(0);
  });
});