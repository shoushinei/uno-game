// ========================================
// ★M4★ 追加した10種の実績のテスト
//
// 併せて「フロントの表示メタ情報とサーバーの判定IDが一致しているか」も
// 機械的に守る。片方だけ足すと、解除されても画面に出ない／名前の無い実績が
// 出る、という壊れ方をするため。
// ========================================
import { describe, it, expect } from 'vitest';
import {
  analyzePlayerActions,
  buildCardById,
  evaluateAchievements,
} from './achievements-logic.ts';
import { ACHIEVEMENTS } from '../../src/achievements.ts';
import { ICONS, TITLES } from '../../src/cosmetics.ts';

const E = (type, playerId, args = {}) => ({ type, playerId, args, ts: 0 });

const hands = {
  me: [
    { s: '♠', v: '4', id: '♠4' }, { s: '♠', v: '5', id: '♠5' }, { s: '♠', v: '6', id: '♠6' },
    { s: '♠', v: '3', id: '♠3' }, { s: '♥', v: '9', id: '♥9' },
    { s: '🃏', v: 'JOKER', id: 'JOKER-me' },
  ],
  p2: [
    { s: '🃏', v: 'JOKER', id: 'JOKER-p2' },
    { s: '♦', v: 'K', id: '♦K' },
  ],
};
const cardById = buildCardById(hands);
const analyze = (log, uid = 'me') => analyzePlayerActions(log, uid, cardById, false);

// ----------------------------------------
// トランプの技
// ----------------------------------------
describe('階段・ジョーカー', () => {
  it('同じマークの3枚連番で stairs=true', () => {
    expect(analyze([E('trumpPlay', 'me', { cardIds: ['♠4', '♠5', '♠6'] })]).stairs).toBe(true);
  });

  it('連番でなければ stairs=false', () => {
    expect(analyze([E('trumpPlay', 'me', { cardIds: ['♠4', '♠6', '♥9'] })]).stairs).toBe(false);
  });

  it('ジョーカー単騎で jokerSingle=true', () => {
    expect(analyze([E('trumpPlay', 'me', { cardIds: ['JOKER-me'] })]).jokerSingle).toBe(true);
  });

  it('複数枚にジョーカーが混じっただけでは jokerSingle=false', () => {
    expect(analyze([E('trumpPlay', 'me', { cardIds: ['JOKER-me', '♠4'] })]).jokerSingle).toBe(false);
  });
});

describe('♠3のジョーカー返し', () => {
  it('他人のジョーカー単騎の直後に♠3単騎を出すと spadeThree=true', () => {
    const log = [
      E('trumpPlay', 'p2', { cardIds: ['JOKER-p2'] }),
      E('trumpPlay', 'me', { cardIds: ['♠3'] }),
    ];
    expect(analyze(log).spadeThree).toBe(true);
  });

  it('自分のジョーカーを自分の♠3で返しても spadeThree=false', () => {
    const log = [
      E('trumpPlay', 'me', { cardIds: ['JOKER-me'] }),
      E('trumpPlay', 'me', { cardIds: ['♠3'] }),
    ];
    expect(analyze(log).spadeThree).toBe(false);
  });

  it('ジョーカーの直後でない♠3単騎は spadeThree=false（空の場に出しただけ）', () => {
    const log = [
      E('trumpPlay', 'p2', { cardIds: ['♦K'] }),
      E('trumpPlay', 'me', { cardIds: ['♠3'] }),
    ];
    expect(analyze(log).spadeThree).toBe(false);
  });
});

// ----------------------------------------
// UNOの返し
// ----------------------------------------
describe('+2/+4のカウンター', () => {
  const d2 = by => E('unoPlay', by, { cardIdx: 0, card: { c: 'r', t: 'd2', v: '+2' } });
  const w4 = by => E('unoPlay', by, { cardIdx: 0, card: { c: 'w', t: 'w4', v: '+4' } });
  const num = by => E('unoPlay', by, { cardIdx: 0, card: { c: 'r', t: 'num', v: '5' } });

  it('他人の+2に自分の+2を重ねると drawStack=true', () => {
    expect(analyze([d2('p2'), d2('me')]).drawStack).toBe(true);
  });

  it('+2に+4でも成立する', () => {
    expect(analyze([d2('p2'), w4('me')]).drawStack).toBe(true);
  });

  it('自分が最初に出しただけでは drawStack=false', () => {
    expect(analyze([d2('me')]).drawStack).toBe(false);
  });

  it('間に数字カードが挟まると連鎖が切れる', () => {
    expect(analyze([d2('p2'), num('p2'), d2('me')]).drawStack).toBe(false);
  });

  it('誰かが引いた（累積解消）後の+2は返しではない', () => {
    expect(analyze([d2('p2'), E('unoDraw', 'p2', { count: 2 }), d2('me')]).drawStack).toBe(false);
  });
});

// ----------------------------------------
// ヨットモード
// ----------------------------------------
describe('ヨット対決', () => {
  // yachtDuel の playerId は常に attacker（yacht-actions.ts の仕様）なので、
  // defender 側の集計は args から拾えていないといけない
  const duel = (attackerId, defenderId, result, attackerBest = null, defenderBest = null) =>
    E('yachtDuel', attackerId, { attackerId, defenderId, result, attackerBest, defenderBest });

  it('自分から挑むと yachtChallenged=true', () => {
    expect(analyze([duel('me', 'p2', 'attacker')]).yachtChallenged).toBe(true);
  });

  it('挑まれた側は yachtChallenged=false（挑戦した実績なので）', () => {
    expect(analyze([duel('p2', 'me', 'attacker')]).yachtChallenged).toBe(false);
  });

  it('★playerIdがattackerでも、defender側の勝敗と役を拾える★', () => {
    const log = [duel('p2', 'me', 'defender', { category: '5', score: 10 }, { category: 'yacht', score: 50 })];
    const a = analyze(log);
    expect(a.yachtWins).toBe(1);
    expect(a.yachtBest).toBe(true);
  });

  it('勝った回数だけ yachtWins が増える', () => {
    const log = [
      duel('me', 'p2', 'attacker'),
      duel('me', 'p2', 'defender'),
      duel('me', 'p2', 'attacker'),
    ];
    expect(analyze(log).yachtWins).toBe(2);
  });

  it('引き分けは勝ちに数えない', () => {
    expect(analyze([duel('me', 'p2', 'draw')]).yachtWins).toBe(0);
  });

  it('無関係な対決は自分の集計に入らない', () => {
    const log = [duel('p2', 'p3', 'attacker', { category: 'yacht', score: 50 })];
    const a = analyze(log);
    expect(a.yachtWins).toBe(0);
    expect(a.yachtBest).toBe(false);
  });

  it('スコア0のヨット役（不成立）は yachtBest にしない', () => {
    expect(analyze([duel('me', 'p2', 'attacker', { category: 'yacht', score: 0 })]).yachtBest).toBe(false);
  });
});

describe('親の権限の回数', () => {
  it('自分の pickParentColor だけ数える', () => {
    const log = [E('pickParentColor', 'me', { color: 'red' }), E('pickParentColor', 'p2', { color: 'blue' })];
    expect(analyze(log).parentColorCount).toBe(1);
  });
});

// ----------------------------------------
// しきい値
// ----------------------------------------
describe('evaluateAchievements — M4の10種', () => {
  const noActs = {
    sayUnoCount: 0, revolution: false, eightCut: false, doubleFinish: false,
    stairs: false, jokerSingle: false, spadeThree: false, drawStack: false,
    yachtChallenged: false, yachtBest: false, yachtWins: 0, parentColorCount: 0,
  };
  const evalWith = (over = {}, actOver = {}) => evaluateAchievements({
    statsBefore: { wins: 5 },
    statsAfter: { games: 5, wins: 5, winStreak: 0, loseStreak: 0 },
    rank: 3, sayUnoCumulative: 0, yachtWinCumulative: 0, parentColorCumulative: 0,
    ...over,
    actions: { ...noActs, ...actOver },
  });

  it('技系はその場のプレイで解除される', () => {
    expect(evalWith({}, { stairs: true })).toContain('stairs');
    expect(evalWith({}, { jokerSingle: true })).toContain('joker-single');
    expect(evalWith({}, { spadeThree: true })).toContain('spade-three');
    expect(evalWith({}, { drawStack: true })).toContain('draw-stack');
    expect(evalWith({}, { yachtChallenged: true })).toContain('yacht-first');
    expect(evalWith({}, { yachtBest: true })).toContain('yacht-best');
  });

  it('累積系はしきい値で解除される', () => {
    expect(evalWith({ yachtWinCumulative: 2 })).not.toContain('yacht-win-3');
    expect(evalWith({ yachtWinCumulative: 3 })).toContain('yacht-win-3');
    expect(evalWith({ parentColorCumulative: 4 })).not.toContain('parent-color-5');
    expect(evalWith({ parentColorCumulative: 5 })).toContain('parent-color-5');
    expect(evalWith({ statsAfter: { games: 49, wins: 0, winStreak: 0, loseStreak: 0 } })).not.toContain('games-50');
    expect(evalWith({ statsAfter: { games: 50, wins: 0, winStreak: 0, loseStreak: 0 } })).toContain('games-50');
    expect(evalWith({ statsAfter: { games: 1, wins: 9, winStreak: 0, loseStreak: 0 } })).not.toContain('win-10');
    expect(evalWith({ statsAfter: { games: 1, wins: 10, winStreak: 0, loseStreak: 0 } })).toContain('win-10');
  });

  it('何もしていなければ新しい実績は出ない', () => {
    const ids = evalWith();
    for (const id of ['stairs', 'joker-single', 'spade-three', 'draw-stack',
                      'yacht-first', 'yacht-best', 'yacht-win-3', 'parent-color-5', 'games-50', 'win-10']) {
      expect(ids).not.toContain(id);
    }
  });
});

// ----------------------------------------
// ★ID契約★ フロントとサーバーの一致
// ----------------------------------------
describe('実績IDの契約', () => {
  const frontIds = new Set(ACHIEVEMENTS.map(a => a.id));

  it('サーバーが返しうるIDは、すべてフロントの表示メタ情報に存在する', () => {
    // 全条件を満たす入力で、サーバーが出しうるIDを洗い出す
    const allIds = evaluateAchievements({
      statsBefore: { wins: 0 },
      statsAfter: { games: 50, wins: 10, winStreak: 3, loseStreak: 3 },
      rank: 1,
      sayUnoCumulative: 5,
      yachtWinCumulative: 3,
      parentColorCumulative: 5,
      actions: {
        sayUnoCount: 5, revolution: true, eightCut: true, doubleFinish: true,
        stairs: true, jokerSingle: true, spadeThree: true, drawStack: true,
        yachtChallenged: true, yachtBest: true, yachtWins: 3, parentColorCount: 5,
      },
    });
    for (const id of allIds) {
      expect(frontIds.has(id), `サーバーの実績ID "${id}" がフロントに無い`).toBe(true);
    }
    // クライアント記録の reaction-first 以外は、すべてサーバーから出せる
    const serverIds = new Set(allIds);
    for (const meta of ACHIEVEMENTS) {
      if (meta.id === 'reaction-first') continue;
      expect(serverIds.has(meta.id), `フロントの実績ID "${meta.id}" をサーバーが出せない`).toBe(true);
    }
  });

  it('実績IDに重複が無い', () => {
    expect(frontIds.size).toBe(ACHIEVEMENTS.length);
  });

  it('アイコン・称号の解除条件は実在する実績IDを指している', () => {
    for (const c of [...ICONS, ...TITLES]) {
      if (c.unlock === null) continue;
      expect(frontIds.has(c.unlock), `"${c.value}" の解除条件 "${c.unlock}" は実在しない実績`).toBe(true);
    }
  });

  it('アイコン・称号の値に重複が無い', () => {
    expect(new Set(ICONS.map(c => c.value)).size).toBe(ICONS.length);
    expect(new Set(TITLES.map(c => c.value)).size).toBe(TITLES.length);
  });
});
