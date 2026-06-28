// ========================================
// trump-logic.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import {
  buildTrumpDeck,
  trumpStrength,
  trumpIsReversed,
  trumpPowerForValue,
  analyzeTrumpPlay,
  trumpCanPlay,
  sortTrumpHand,
  applyTrumpPlay,
  applyTrumpPass,
} from './trump-logic.js';

// ---- テスト用ヘルパー ----
const c    = (s, v) => ({ s, v, id: `${s}${v}` });
const JOKER = { s: '🃏', v: 'JOKER', id: 'JOKER' };

/** applyTrumpPlay 用の最小ゲーム状態を作るファクトリ */
function makeGame(overrides = {}) {
  return {
    order: ['p1', 'p2'],
    ci: 0,
    phase: 'trump',
    trumpField: [],
    trumpFieldMeta: null,
    trumpRevolution: false,
    trumpElevenBack: false,
    trumpSuitLock: null,
    trumpEffect: null,
    hasParent: null,
    trumpHands: { p1: [], p2: [] },
    ...overrides,
  };
}

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
    expect(trumpStrength(c('♠', '3'))).toBe(1);
  });

  it('2が2番目に強い（13）', () => {
    expect(trumpStrength(c('♠', '2'))).toBe(13);
  });

  it('JOKERが最強（14）', () => {
    expect(trumpStrength(JOKER)).toBe(14);
  });

  it('A > K', () => {
    expect(trumpStrength(c('♠', 'A')) > trumpStrength(c('♠', 'K'))).toBeTruthy();
  });
});

// ========================================
// trumpCanPlay のテスト（基本）
// ========================================
describe('trumpCanPlay', () => {
  it('場が空なら1枚出せる', () => {
    expect(trumpCanPlay([c('♠', '5')], [])).toBeTruthy();
  });

  it('場が空なら複数枚出せる', () => {
    expect(trumpCanPlay([c('♠', '7'), c('♥', '7')], [])).toBeTruthy();
  });

  it('場より強い同枚数は出せる', () => {
    expect(trumpCanPlay([c('♠', '9')], [c('♥', '5')])).toBeTruthy();
  });

  it('場より弱い場合は出せない', () => {
    expect(trumpCanPlay([c('♠', '3')], [c('♥', '9')])).toBeFalsy();
  });

  it('場と枚数が違う場合は出せない', () => {
    expect(trumpCanPlay([c('♠', '9'), c('♥', '9')], [c('♣', '5')])).toBeFalsy();
  });

  it('複数枚は同じ数字でないと出せない', () => {
    expect(trumpCanPlay([c('♠', '9'), c('♥', '8')], [])).toBeFalsy();
  });

  it('選択なしは出せない', () => {
    expect(trumpCanPlay([], [])).toBeFalsy();
  });

  it('JOKERは場が空なら出せる', () => {
    expect(trumpCanPlay([JOKER], [])).toBeTruthy();
  });

  it('JOKERは場のどんなカードにも勝てる', () => {
    expect(trumpCanPlay([JOKER], [c('♠', '2')])).toBeTruthy();
  });
});

// ========================================
// sortTrumpHand のテスト
// ========================================
describe('sortTrumpHand', () => {
  it('弱い順（3→A→2→JOKER）にソートされる', () => {
    const hand = [JOKER, c('♠', '2'), c('♥', '3'), c('♦', 'A')];
    const sorted = sortTrumpHand(hand);
    expect(sorted[0].v).toBe('3');
    expect(sorted[3].v).toBe('JOKER');
  });

  it('元の配列を変更しない（非破壊）', () => {
    const hand = [JOKER, c('♠', '3')];
    const sorted = sortTrumpHand(hand);
    expect(hand[0].v).toBe('JOKER');
  });
});

// ========================================
// 1. 階段のテスト
// ========================================
describe('階段（同スーツ3枚以上連続）', () => {

  // ---- 正常系 ----
  it('[正常] 同スーツ3枚連続は階段として出せる', () => {
    expect(trumpCanPlay(
      [c('♠', '3'), c('♠', '4'), c('♠', '5')], []
    )).toBeTruthy();
  });

  it('[正常] 同スーツ4枚連続も階段として出せる', () => {
    expect(trumpCanPlay(
      [c('♥', '7'), c('♥', '8'), c('♥', '9'), c('♥', '10')], []
    )).toBeTruthy();
  });

  it('[正常] 階段は analyzeTrumpPlay が type=sequence を返す', () => {
    const meta = analyzeTrumpPlay(
      [c('♠', '5'), c('♠', '6'), c('♠', '7')], {}
    );
    expect(meta?.type).toBe('sequence');
    expect(meta?.length).toBe(3);
  });

  it('[正常] 場の階段より最大値が大きい同枚数の階段は出せる', () => {
    const field = [c('♠', '3'), c('♠', '4'), c('♠', '5')]; // 最大power=5
    const play  = [c('♥', '6'), c('♥', '7'), c('♥', '8')]; // 最大power=6
    expect(trumpCanPlay(play, field)).toBeTruthy();
  });

  it('[正常] 場が階段のとき、異なるスーツの同強度階段も出せる（マーク不問）', () => {
    // 大富豪の階段はスーツ一致必須だが、後続プレイは別スーツでも可
    const field = [c('♠', '3'), c('♠', '4'), c('♠', '5')];
    const play  = [c('♥', '6'), c('♥', '7'), c('♥', '8')];
    expect(trumpCanPlay(play, field)).toBeTruthy();
  });

  // ---- 異常系 ----
  it('[異常] 場の階段より弱い階段は出せない', () => {
    const field = [c('♠', '7'), c('♠', '8'), c('♠', '9')];
    const play  = [c('♥', '3'), c('♥', '4'), c('♥', '5')];
    expect(trumpCanPlay(play, field)).toBeFalsy();
  });

  it('[異常] 場が階段のとき、重ね数字（set）は型が違うので出せない', () => {
    const field = [c('♠', '3'), c('♠', '4'), c('♠', '5')];
    expect(trumpCanPlay(
      [c('♠', '9'), c('♥', '9'), c('♦', '9')], field
    )).toBeFalsy();
  });

  it('[異常] 場が3枚階段のとき、4枚階段は枚数違いで出せない', () => {
    const field = [c('♠', '3'), c('♠', '4'), c('♠', '5')];
    const play  = [c('♥', '8'), c('♥', '9'), c('♥', '10'), c('♥', 'J')];
    expect(trumpCanPlay(play, field)).toBeFalsy();
  });

  it('[異常] マークが混在する場合は階段にならない', () => {
    expect(trumpCanPlay(
      [c('♠', '3'), c('♥', '4'), c('♠', '5')], []
    )).toBeFalsy();
  });

  it('[異常] 2枚だけでは階段は成立しない', () => {
    expect(trumpCanPlay(
      [c('♠', '3'), c('♠', '4')], []
    )).toBeFalsy();
  });

  it('[異常] 数字が連続していない（穴あり）場合は階段にならない', () => {
    expect(trumpCanPlay(
      [c('♠', '3'), c('♠', '4'), c('♠', '6')], []
    )).toBeFalsy();
  });
});

// ========================================
// ジョーカーをオールマイティに使うテスト
// ========================================
describe('ジョーカーのオールマイティ使用', () => {

  // ---- 正常系 ----
  it('[正常] ジョーカーが階段の穴埋めになれる（♠3, JOKER, ♠5 → 3-4-5）', () => {
    expect(trumpCanPlay(
      [c('♠', '3'), JOKER, c('♠', '5')], []
    )).toBeTruthy();
  });

  it('[正常] ジョーカーが重ね数字の1枚として使える（♠7, JOKER）', () => {
    expect(trumpCanPlay(
      [c('♠', '7'), JOKER], []
    )).toBeTruthy();
  });

  it('[正常] ジョーカー入り階段は type が sequence になる', () => {
    const meta = analyzeTrumpPlay(
      [c('♠', '3'), JOKER, c('♠', '5')], {}
    );
    expect(meta?.type).toBe('sequence');
  });

  it('[正常] ジョーカー入り重ね数字は type が set になる', () => {
    const meta = analyzeTrumpPlay(
      [c('♠', '7'), JOKER], {}
    );
    expect(meta?.type).toBe('set');
  });

  it('[正常] ジョーカー単体は type=single、rank=JOKER になる', () => {
    const meta = analyzeTrumpPlay([JOKER], {});
    expect(meta?.type).toBe('single');
    expect(meta?.rank).toBe('JOKER');
  });

  // ---- 異常系（仕様上の制限）----
  it('[仕様] ジョーカー入り組み合わせは rank がジョーカーにならない（数字の方になる）', () => {
    // 「組み合わせて出したときは最強のカード扱いにはならない」
    const meta = analyzeTrumpPlay([c('♠', '7'), JOKER], {});
    expect(meta?.rank).toBe('7');
    expect(meta?.rank).not.toBe('JOKER');
  });
});

// ========================================
// 2. 重ね数字のテスト
// ========================================
describe('重ね数字（同じ数字の複数枚出し）', () => {

  // ---- 正常系 ----
  it('[正常] 同じ数字2枚は出せる', () => {
    expect(trumpCanPlay([c('♠', '7'), c('♥', '7')], [])).toBeTruthy();
  });

  it('[正常] 同じ数字3枚は出せる', () => {
    expect(trumpCanPlay(
      [c('♠', '9'), c('♥', '9'), c('♦', '9')], []
    )).toBeTruthy();
  });

  it('[正常] 場の重ね数字より強い同枚数は出せる', () => {
    const field = [c('♠', '5'), c('♥', '5')];
    const play  = [c('♦', '8'), c('♣', '8')];
    expect(trumpCanPlay(play, field)).toBeTruthy();
  });

  // ---- 異常系 ----
  it('[異常] 場の重ね数字と同じ強さは出せない', () => {
    const field = [c('♠', '7'), c('♥', '7')];
    const play  = [c('♦', '7'), c('♣', '7')];
    expect(trumpCanPlay(play, field)).toBeFalsy();
  });

  it('[異常] 場が2枚のとき3枚出しは枚数違いで出せない', () => {
    const field = [c('♠', '5'), c('♥', '5')];
    const play  = [c('♦', '9'), c('♣', '9'), c('♠', '9')];
    expect(trumpCanPlay(play, field)).toBeFalsy();
  });

  it('[異常] 異なる数字の複数枚は重ね数字にならない', () => {
    expect(trumpCanPlay([c('♠', '9'), c('♥', '8')], [])).toBeFalsy();
  });
});

// ========================================
// 3. 革命のテスト
// ========================================
describe('革命', () => {

  // ---- 強さ変化の確認 ----
  it('[正常] 通常時: 3(弱) < 2 < JOKER(最強)', () => {
    expect(trumpPowerForValue('3', {})).toBeLessThan(trumpPowerForValue('2', {}));
    expect(trumpPowerForValue('2', {})).toBeLessThan(trumpPowerForValue('JOKER', {}));
  });

  it('[正常] 革命時: 強さが反転し 2(弱) < 3 < JOKER(最強)', () => {
    const g = { trumpRevolution: true };
    expect(trumpPowerForValue('2', g)).toBeLessThan(trumpPowerForValue('3', g));
    expect(trumpPowerForValue('3', g)).toBeLessThan(trumpPowerForValue('JOKER', g));
  });

  it('[正常] 革命時: 3 > A（通常では逆）', () => {
    const g = { trumpRevolution: true };
    expect(trumpPowerForValue('3', g)).toBeGreaterThan(trumpPowerForValue('A', g));
  });

  it('[正常] JOKERの強さは革命中でも変わらない（常に最強）', () => {
    expect(trumpPowerForValue('JOKER', {})).toBe(
      trumpPowerForValue('JOKER', { trumpRevolution: true })
    );
  });

  it('[正常] trumpIsReversed: 革命のみで true', () => {
    expect(trumpIsReversed({ trumpRevolution: true })).toBe(true);
  });

  it('[正常] trumpIsReversed: イレブンバックのみで true', () => {
    expect(trumpIsReversed({ trumpElevenBack: true })).toBe(true);
  });

  it('[正常] trumpIsReversed: 革命 + イレブンバック同時は false（打ち消し合い）', () => {
    expect(trumpIsReversed({ trumpRevolution: true, trumpElevenBack: true })).toBe(false);
  });

  // ---- 4枚同時で革命発動 ----
  it('[正常] 4枚同時出しで革命が発動し trumpRevolution が true になる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','5'), c('♥','5'), c('♦','5'), c('♣','5')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠5','♥5','♦5','♣5'], 'Alice');
    expect(result?.g.trumpRevolution).toBe(true);
    expect(result?.g.trumpEffect?.types).toContain('revolution');
  });

  it('[正常] 革命中に4枚出すと革命返しになり trumpRevolution が false に戻る', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','5'), c('♥','5'), c('♦','5'), c('♣','5')], p2: [] },
      trumpRevolution: true,
    });
    const result = applyTrumpPlay(g, 'p1', ['♠5','♥5','♦5','♣5'], 'Alice');
    expect(result?.g.trumpRevolution).toBe(false);
  });

  it('[正常] 4枚の階段でも革命が発動する', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','3'), c('♠','4'), c('♠','5'), c('♠','6')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠3','♠4','♠5','♠6'], 'Alice');
    expect(result?.g.trumpRevolution).toBe(true);
  });

  it('[異常] 3枚では革命は発動しない', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','5'), c('♥','5'), c('♦','5')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠5','♥5','♦5'], 'Alice');
    expect(result?.g.trumpRevolution).toBe(false);
  });

  // ---- 革命中の出せる/出せない ----
  it('[正常] 革命中は弱くなった2の上に3で出せる', () => {
    const g = { trumpRevolution: true };
    expect(trumpCanPlay([c('♠', '3')], [c('♥', '2')], g)).toBeTruthy();
  });

  it('[異常] 革命中は2が最弱なので3がある場に2では出せない', () => {
    const g = { trumpRevolution: true };
    expect(trumpCanPlay([c('♠', '2')], [c('♥', '3')], g)).toBeFalsy();
  });
});

// ========================================
// 4. ジョーカー単体のテスト
// ========================================
describe('ジョーカー単体出し', () => {

  it('[正常] ジョーカー単体は場が空のとき出せる', () => {
    expect(trumpCanPlay([JOKER], [])).toBeTruthy();
  });

  it('[正常] ジョーカー単体は場の2にも勝てる', () => {
    expect(trumpCanPlay([JOKER], [c('♠', '2')])).toBeTruthy();
  });

  it('[正常] ジョーカー単体を出すと場が流れ hasParent が設定される', () => {
    const g = makeGame({
      trumpHands: { p1: [JOKER], p2: [] },
      trumpField: [c('♥', 'K')],
    });
    const result = applyTrumpPlay(g, 'p1', ['JOKER'], 'Alice');
    expect(result?.g.trumpField).toEqual([]);
    expect(result?.g.hasParent).toBe('p1');
    expect(result?.g.trumpEffect?.types).toContain('jokerSingle');
  });

  it('[正常] ジョーカー単体で場流しのとき trumpSuitLock と trumpElevenBack もリセット', () => {
    const g = makeGame({
      trumpHands: { p1: [JOKER], p2: [] },
      trumpField: [c('♠', 'A')],
      trumpSuitLock: ['♠'],
      trumpElevenBack: true,
    });
    const result = applyTrumpPlay(g, 'p1', ['JOKER'], 'Alice');
    expect(result?.g.trumpSuitLock).toBeNull();
    expect(result?.g.trumpElevenBack).toBe(false);
  });
});

// ========================================
// 5. 8切りのテスト
// ========================================
describe('8切り', () => {

  it('[正常] 8を出すと場が流れる（trumpField が空になる）', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
      trumpField: [c('♥', '5')],
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result?.g.trumpField).toEqual([]);
  });

  it('[正常] 8を出すと出したプレイヤーが親になる（hasParent が設定される）', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result?.g.hasParent).toBe('p1');
  });

  it('[正常] 8を複数枚出しても8切りが成立する', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8'), c('♥', '8')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8','♥8'], 'Alice');
    expect(result?.g.trumpField).toEqual([]);
    expect(result?.g.hasParent).toBe('p1');
    expect(result?.g.trumpEffect?.types).toContain('eightCut');
  });

  it('[仕様] 8を含む階段では8切りが成立しない（場は流れない）', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','7'), c('♠','8'), c('♠','9')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠7','♠8','♠9'], 'Alice');
    expect(result).not.toBeNull();           // 階段として出せる
    expect(result?.g.trumpField.length).toBeGreaterThan(0); // 場は流れない
    expect(result?.g.hasParent).toBeNull();
    expect(result?.g.trumpEffect?.types ?? []).not.toContain('eightCut');
  });

  it('[正常] 8切り後に trumpElevenBack と trumpSuitLock もリセットされる', () => {
    // イレブンバック中: 強さが反転するので ♥9(逆power=7)の上に ♠8(逆power=8)で出せる
    // → 8切りが成立して trumpElevenBack と trumpSuitLock の両方がリセットされる
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
      trumpField: [c('♥', '9')],
      trumpElevenBack: true,
      trumpSuitLock: null,
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result).not.toBeNull();
    expect(result?.g.trumpElevenBack).toBe(false);
    expect(result?.g.trumpSuitLock).toBeNull();
  });

  it('[正常] 8切りのログメッセージに "8切り" が含まれる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result?.logMsg).toContain('8切り');
  });
});

// ========================================
// 6. イレブンバックのテスト
// ========================================
describe('イレブンバック（Jダウン）', () => {

  it('[正常] Jを出すと trumpElevenBack が true になる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', 'J')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠J'], 'Alice');
    expect(result?.g.trumpElevenBack).toBe(true);
    expect(result?.g.trumpEffect?.types).toContain('elevenBack');
  });

  it('[正常] Jを複数枚出しても成立する', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', 'J'), c('♥', 'J')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠J','♥J'], 'Alice');
    expect(result?.g.trumpElevenBack).toBe(true);
  });

  it('[仕様] Jを含む階段ではイレブンバックが成立しない', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠','9'), c('♠','10'), c('♠','J')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠9','♠10','♠J'], 'Alice');
    expect(result).not.toBeNull();       // 階段として出せる
    expect(result?.g.trumpElevenBack).toBe(false); // Jバックは発動しない
  });

  it('[正常] イレブンバック中は強さが反転する（3 > 9）', () => {
    const g = { trumpElevenBack: true };
    expect(trumpPowerForValue('3', g)).toBeGreaterThan(trumpPowerForValue('9', g));
  });

  it('[正常] 場が流れると（8切りにより）trumpElevenBack が false に戻る', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
      trumpElevenBack: true,
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result?.g.trumpElevenBack).toBe(false);
  });

  it('[正常] イレブンバックのログメッセージに "イレブンバック" が含まれる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', 'J')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠J'], 'Alice');
    expect(result?.logMsg).toContain('イレブンバック');
  });
});

// ========================================
// 7. しばりのテスト
// ========================================
describe('しばり（スーツロック）', () => {

  it('[正常] 同スーツ単体を2回連続で出すとしばりが発生する', () => {
    const g = makeGame({
      trumpHands: { p1: [], p2: [c('♠', '6')] },
      trumpField: [c('♠', '4')],
      trumpFieldMeta: { type: 'single', length: 1, rank: '4', power: 2, suits: ['♠'] },
    });
    const result = applyTrumpPlay(g, 'p2', ['♠6'], 'Bob');
    expect(result?.g.trumpSuitLock).toEqual(['♠']);
    expect(result?.g.trumpEffect?.types).toContain('suitLock');
  });

  it('[正常] マーク組み合わせが一致する複数枚出しでもしばりが発生する', () => {
    // ♠4+♥4 の後に ♠6+♥6 → [♥,♠] しばり
    const g = makeGame({
      trumpHands: { p1: [], p2: [c('♠', '6'), c('♥', '6')] },
      trumpField: [c('♠', '4'), c('♥', '4')],
      trumpFieldMeta: { type: 'set', length: 2, rank: '4', power: 2, suits: ['♥', '♠'] },
    });
    const result = applyTrumpPlay(g, 'p2', ['♠6','♥6'], 'Bob');
    expect(result?.g.trumpSuitLock).not.toBeNull();
    expect(result?.g.trumpEffect?.types).toContain('suitLock');
  });

  it('[異常] マーク組み合わせが違う場合はしばりが発生しない', () => {
    // ♠4+♥4 の後に ♠6+♦6（♦が違う）→ しばりなし
    const g = makeGame({
      trumpHands: { p1: [], p2: [c('♠', '6'), c('♦', '6')] },
      trumpField: [c('♠', '4'), c('♥', '4')],
      trumpFieldMeta: { type: 'set', length: 2, rank: '4', power: 2, suits: ['♥', '♠'] },
    });
    const result = applyTrumpPlay(g, 'p2', ['♠6','♦6'], 'Bob');
    expect(result?.g.trumpSuitLock).toBeNull();
  });

  it('[正常] しばり中は指定スーツ以外のカードは出せない', () => {
    const g = { trumpSuitLock: ['♠'] };
    expect(trumpCanPlay([c('♥', '9')], [c('♠', '5')], g)).toBeFalsy();
  });

  it('[正常] しばり中でも指定スーツのカードは出せる', () => {
    const g = { trumpSuitLock: ['♠'] };
    expect(trumpCanPlay([c('♠', '9')], [c('♠', '5')], g)).toBeTruthy();
  });

  it('[正常] しばり中でもジョーカーは出せる（スーツに合わせて扱われる）', () => {
    const g = { trumpSuitLock: ['♠'] };
    expect(trumpCanPlay([JOKER], [c('♠', '5')], g)).toBeTruthy();
  });

  it('[正常] 8切りで場が流れるとしばりも解除される', () => {
    // しばり♠中は♠8のみ出せる → 8切りにより trumpSuitLock がリセットされる
    const g = makeGame({
      trumpHands: { p1: [c('♠', '8')], p2: [] },
      trumpField: [c('♠', '5')],
      trumpSuitLock: ['♠'],
    });
    const result = applyTrumpPlay(g, 'p1', ['♠8'], 'Alice');
    expect(result?.g.trumpSuitLock).toBeNull();
  });
});

// ========================================
// 8. スペードの3のテスト
// ========================================
describe('スペードの3', () => {

  it('[正常] 場にジョーカー単体があるとき ♠3 は出せる', () => {
    expect(trumpCanPlay([c('♠', '3')], [JOKER])).toBeTruthy();
  });

  it('[正常] ♠3 でジョーカーに勝つと analyzeTrumpPlay が spadeThreeBreak: true を返す', () => {
    const meta = analyzeTrumpPlay([c('♠', '3')], {}, [JOKER]);
    expect(meta?.spadeThreeBreak).toBe(true);
  });

  it('[正常] ♠3 でジョーカーを返すと場が流れる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '3')], p2: [] },
      trumpField: [JOKER],
    });
    const result = applyTrumpPlay(g, 'p1', ['♠3'], 'Alice');
    expect(result?.g.trumpField).toEqual([]);
    expect(result?.g.hasParent).toBe('p1');
    expect(result?.g.trumpEffect?.types).toContain('spadeThree');
  });

  it('[正常] ♠3 でジョーカーを返すとログにスペード3の演出テキストが含まれる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '3')], p2: [] },
      trumpField: [JOKER],
    });
    const result = applyTrumpPlay(g, 'p1', ['♠3'], 'Alice');
    // ログには "♠3 ジョーカー返し！" が含まれる（effectLabels.spadeThree の内容）
    expect(result?.logMsg).toContain('ジョーカー返し');
  });

  it('[異常] ♠3 は場にジョーカー以外のカードがある場合は弱いカードとして扱われる', () => {
    // 場に ♥9 がある → ♠3（強さ1）< ♥9（強さ7）なので出せない
    expect(trumpCanPlay([c('♠', '3')], [c('♥', '9')])).toBeFalsy();
  });

  it('[異常] ♦3（スペード以外の3）は場のジョーカーに対して特殊効果がない', () => {
    // ♦3 は強さが1なので JOKER（強さ14）より弱く出せない
    expect(trumpCanPlay([c('♦', '3')], [JOKER])).toBeFalsy();
  });

  it('[異常] ♠3 は場がジョーカー2枚のとき（1枚 vs 2枚）出せない', () => {
    // 枚数不一致なのでルール上出せない
    const fakeTwo = [{ ...JOKER, id: 'JOKER_A' }, { ...JOKER, id: 'JOKER_B' }];
    expect(trumpCanPlay([c('♠', '3')], fakeTwo)).toBeFalsy();
  });
});

// ========================================
// applyTrumpPlay の総合テスト
// ========================================
describe('applyTrumpPlay 基本動作', () => {

  it('[異常] 手札にないカードを出そうとすると null を返す', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '5')], p2: [] },
    });
    expect(applyTrumpPlay(g, 'p1', ['♥9'], 'Alice')).toBeNull();
  });

  it('[異常] 場より弱いカードを出そうとすると null を返す', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '3')], p2: [] },
      trumpField: [c('♥', 'K')],
    });
    expect(applyTrumpPlay(g, 'p1', ['♠3'], 'Alice')).toBeNull();
  });

  it('[正常] 出した後は手札からカードが減る', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '7'), c('♥', 'K')], p2: [] },
    });
    applyTrumpPlay(g, 'p1', ['♠7'], 'Alice');
    expect(g.trumpHands['p1'].length).toBe(1);
    expect(g.trumpHands['p1'][0].v).toBe('K');
  });

  it('[正常] 出した後は phase が uno になる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '7')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠7'], 'Alice');
    expect(result?.g.phase).toBe('uno');
  });

  it('[正常] logMsg にプレイヤー名とカード名が含まれる', () => {
    const g = makeGame({
      trumpHands: { p1: [c('♠', '7')], p2: [] },
    });
    const result = applyTrumpPlay(g, 'p1', ['♠7'], 'Alice');
    expect(result?.logMsg).toContain('Alice');
    expect(result?.logMsg).toContain('♠7');
  });

  it('[異常] cardIds が空配列のときは null を返す', () => {
    const g = makeGame({ trumpHands: { p1: [], p2: [] } });
    expect(applyTrumpPlay(g, 'p1', [], 'Alice')).toBeNull();
  });

  it('[正常] パスすると phase が uno になり logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame();
    const result = applyTrumpPass(g, 'p1', 'Alice');
    expect(result.g.phase).toBe('uno');
    expect(result.logMsg).toContain('Alice');
  });
});
