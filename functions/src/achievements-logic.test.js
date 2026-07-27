// ========================================
// achievements-logic.ts 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import {
  analyzePlayerActions,
  buildCardById,
  evaluateAchievements,
} from './achievements-logic.ts';

// テスト用のカード表: initialState.trumpHands 相当
const hands = {
  me: [
    { s: '♠', v: '8', id: '♠8' },
    { s: '♠', v: 'K', id: '♠K' },
    { s: '♥', v: '3', id: '♥3' },
    { s: '♦', v: '3', id: '♦3' },
    { s: '♣', v: '3', id: '♣3' },
    { s: '♠', v: '6', id: '♠6' },
    { s: '♠', v: '7', id: '♠7' },
  ],
  p2: [{ s: '♥', v: '8', id: '♥8' }],
};
const cardById = buildCardById(hands);

const E = (type, playerId, args = {}) => ({ type, playerId, args, ts: 0 });

describe('buildCardById', () => {
  it('全プレイヤーの初期札を id→{s,v} に統合する', () => {
    expect(cardById['♠8']).toEqual({ s: '♠', v: '8' });
    expect(cardById['♥8']).toEqual({ s: '♥', v: '8' });
    expect(Object.keys(cardById)).toHaveLength(8);
  });
});

describe('analyzePlayerActions — 革命', () => {
  it('4枚以上出しで revolution=true', () => {
    const log = [E('trumpPlay', 'me', { cardIds: ['♥3', '♦3', '♣3', '♠K'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).revolution).toBe(true);
  });
  it('3枚以下では revolution=false', () => {
    const log = [E('trumpPlay', 'me', { cardIds: ['♥3', '♦3', '♣3'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).revolution).toBe(false);
  });
});

describe('analyzePlayerActions — 8切り', () => {
  it('8単体は eightCut=true', () => {
    const log = [E('trumpPlay', 'me', { cardIds: ['♠8'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).eightCut).toBe(true);
  });
  it('8を含む階段（6-7-8）は eightCut=false', () => {
    const log = [E('trumpPlay', 'me', { cardIds: ['♠6', '♠7', '♠8'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).eightCut).toBe(false);
  });
  it('8を含まない出しは eightCut=false', () => {
    const log = [E('trumpPlay', 'me', { cardIds: ['♠K'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).eightCut).toBe(false);
  });
  it('他プレイヤーの8切りは自分の実績にならない', () => {
    const log = [E('trumpPlay', 'p2', { cardIds: ['♥8'] })];
    expect(analyzePlayerActions(log, 'me', cardById, false).eightCut).toBe(false);
  });
});

describe('analyzePlayerActions — UNO宣言回数', () => {
  it('自分の sayUno だけ数える', () => {
    const log = [E('sayUno', 'me'), E('sayUno', 'p2'), E('sayUno', 'me')];
    expect(analyzePlayerActions(log, 'me', cardById, false).sayUnoCount).toBe(2);
  });
});

describe('analyzePlayerActions — 同一ターン上がり', () => {
  it('最後のtrumpPlayとunoPlayが同一手番（間に他者なし）なら doubleFinish=true', () => {
    const log = [
      E('trumpPlay', 'p2', { cardIds: ['♥8'] }),
      E('trumpPlay', 'me', { cardIds: ['♠K'] }), // 自分の最後のトランプ（出し切り）
      E('unoPlay', 'me', {}),                    // 直後にUNOも出して上がり
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(true);
  });

  it('トランプを前の手番で出し切っていた（間に他者の手番あり）なら false', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['♠K'] }), // 前の手番でトランプ出し切り
      E('unoPlay', 'p2', {}),                    // 他プレイヤーの手番が挟まる
      E('trumpPlay', 'p2', { cardIds: ['♥8'] }),
      E('unoPlay', 'me', {}),                    // 別の手番でUNO出して上がり
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(false);
  });

  it('間に自分の pickParentColor が挟まってもOK（自分の操作は手番を跨がない）', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['♠K'] }),
      E('pickParentColor', 'me', { color: 'red' }),
      E('unoPlay', 'me', {}),
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(true);
  });

  it('上がっていない（finished=false）なら doubleFinish=false', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['♠K'] }),
      E('unoPlay', 'me', {}),
    ];
    expect(analyzePlayerActions(log, 'me', cardById, false).doubleFinish).toBe(false);
  });

  // ★不具合（最下位に必ず付いてしまう）★
  // 他プレイヤーが全員上がると、最下位の人は1人で手番を回し続ける。
  // 「間に他プレイヤーの操作が無い」だけを同一手番の条件にしていたため、
  // 何手番あとにUNOを出し切っても同一手番とみなされていた。
  it('最下位が1人で手番を回してもtrumpSkipを跨いだら false', () => {
    const log = [
      E('trumpPlay', 'p2', { cardIds: ['♥8'] }),
      E('unoPlay', 'p2', {}),                     // p2 が上がって以降は自分だけ
      E('trumpPlay', 'me', { cardIds: ['♠K'] }),  // ここでトランプを出し切った
      E('trumpSkip', 'me', {}),                   // 次の手番（トランプ0枚で自動スキップ）
      E('unoPlay', 'me', {}),
      E('trumpSkip', 'me', {}),                   // さらに次の手番
      E('unoPlay', 'me', {}),                     // ずっと後の手番でUNOを出し切って上がり
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(false);
  });

  it('自分のunoDrawを跨いだら別の手番なので false', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['♠K'] }),
      E('unoDraw', 'me', { count: 1 }),           // この手番はカードを引いて終了
      E('trumpSkip', 'me', {}),
      E('unoPlay', 'me', {}),                     // 次の手番でUNOを出した
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(false);
  });

  it('間に自分のsayUnoが挟まるのは同一手番なので true', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['♠K'] }),
      E('sayUno', 'me', {}),                      // 出す前の宣言（同じ手番のうち）
      E('unoPlay', 'me', {}),
    ];
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(true);
  });

  // 報告された場面そのもの: 3人卓で1位が同一手番上がり、最後に残った人が
  // 1人で手番を回して上がる。1位だけに付き、最下位には付かないこと。
  it('3人卓の最後まで: 同一手番で上がった人だけ true', () => {
    const log = [
      E('trumpPlay', 'p1', { cardIds: ['♥8'] }),     // p1はここでトランプを出し切った
      E('unoPlay', 'p1', {}),
      E('trumpPlay', 'winner', { cardIds: ['♠K'] }), // winnerは同じ手番で両方出し切り
      E('unoPlay', 'winner', {}),                    // → 1位で上がり
      E('trumpSkip', 'p1', {}),                      // p1の次の手番（トランプ0枚）
      E('unoPlay', 'p1', {}),                        // → 別の手番でUNOを出し切って2位
      // ここから最下位の me が1人で手番を回す
      E('trumpPlay', 'me', { cardIds: ['♦3'] }),     // トランプを出し切った
      E('trumpSkip', 'me', {}),
      E('unoPlay', 'me', {}),
      E('trumpSkip', 'me', {}),
      E('unoPlay', 'me', {}),                        // 何手番もあとにUNOを出し切って上がり
    ];
    // 同じ手番で両方出し切ったのは winner だけ
    expect(analyzePlayerActions(log, 'winner', cardById, true).doubleFinish).toBe(true);
    // p1は間に他プレイヤーの手番を跨いでいる
    expect(analyzePlayerActions(log, 'p1', cardById, true).doubleFinish).toBe(false);
    // ★最下位は1人で回していても、trumpSkip を跨いだ時点で別の手番★
    expect(analyzePlayerActions(log, 'me', cardById, true).doubleFinish).toBe(false);
  });
});

describe('evaluateAchievements', () => {
  const base = {
    statsBefore: { wins: 0 },
    statsAfter: { games: 1, winStreak: 0, loseStreak: 1 },
    rank: 2,
    sayUnoCumulative: 0,
    actions: { revolution: false, eightCut: false, doubleFinish: false },
  };

  it('初ゲームは常に first-game', () => {
    expect(evaluateAchievements(base)).toContain('first-game');
  });
  it('初1位で first-win（それ以前に勝っていないとき）', () => {
    expect(evaluateAchievements({ ...base, rank: 1, statsAfter: { games: 3, winStreak: 1, loseStreak: 0 } }))
      .toContain('first-win');
  });
  it('既に勝ったことがあれば first-win は出ない', () => {
    expect(evaluateAchievements({ ...base, rank: 1, statsBefore: { wins: 2 } }))
      .not.toContain('first-win');
  });
  it('10戦で games-10', () => {
    expect(evaluateAchievements({ ...base, statsAfter: { games: 10, winStreak: 0, loseStreak: 1 } }))
      .toContain('games-10');
  });
  it('3連勝で streak-win-3・3連敗で streak-lose-3', () => {
    expect(evaluateAchievements({ ...base, statsAfter: { games: 3, winStreak: 3, loseStreak: 0 } }))
      .toContain('streak-win-3');
    expect(evaluateAchievements({ ...base, statsAfter: { games: 3, winStreak: 0, loseStreak: 3 } }))
      .toContain('streak-lose-3');
  });
  it('累計UNO宣言5回で uno-declare-5', () => {
    expect(evaluateAchievements({ ...base, sayUnoCumulative: 5 })).toContain('uno-declare-5');
    expect(evaluateAchievements({ ...base, sayUnoCumulative: 4 })).not.toContain('uno-declare-5');
  });
  it('actions フラグで revolution / eight-cut / double-finish', () => {
    const ids = evaluateAchievements({ ...base, actions: { revolution: true, eightCut: true, doubleFinish: true } });
    expect(ids).toEqual(expect.arrayContaining(['revolution', 'eight-cut', 'double-finish']));
  });
});
