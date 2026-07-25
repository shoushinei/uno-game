// ========================================
// replay-engine.ts 単体テスト
//
// game-actions.js（＝Firebase書き込み層）を経由せず、本物の apply* 関数を
// 直接呼んでミニゲームを進行させ、その過程で actionLog を組み立てる。
// その actionLog を ReplayEngine に渡し、「本物のゲーム進行と同じ最終状態を
// 再現できるか」を検証する。
//
// ★このテストの意図★
// 比較対象を「自作の期待値」ではなく「実際に apply* 関数を呼んで得られた
// 本物の結果」にすることで、ReplayEngine 側の実装ミス（分岐の呼び間違い・
// パスカウントの管理ミスなど）だけを純粋に検出できるようにしている。
// ゲームルール自体が将来変わっても、このテストは両方が連動して動くので
// 壊れにくい。
// ========================================
import { describe, it, expect } from 'vitest';
import { ReplayEngine } from './engine.js';
import { applyTrumpPlay, applyTrumpPass } from '../logic/trump-logic.ts';
import { applyUnoDraw, applyUnoPlay } from '../logic/uno-logic.js';
import { applyDuelPenalty } from '../logic/duel-logic.ts';
import { checkAllPassed } from '../logic/game-rules.js';
import { makeActionLogEntry } from './log.js';

const PLAYERS = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
];

const c = (s, v) => ({ s, v, id: `${s}${v}` });
const RED5 = { c: 'red', t: 'num', v: '5' };
const BLUE5 = { c: 'blue', t: 'num', v: '5' };

/**
 * テスト用に小さな初期状態を手組みする。
 * initFusionGame（シャッフルが絡む）は使わず、シナリオを完全に固定する。
 */
function makeInitialState() {
  return {
    order: ['p1', 'p2', 'p3'],
    ci: 0,
    dir: 1,
    phase: 'trump',
    rankings: [],
    trumpHands: {
      p1: [c('♠', '7')],
      p2: [c('♥', '9')],
      p3: [c('♦', '6')],
    },
    trumpField: [],
    trumpFieldMeta: null,
    trumpFieldOwner: null,
    trumpRevolution: false,
    trumpElevenBack: false,
    trumpSuitLock: null,
    trumpEffect: null,
    hasParent: null,
    unoHands: {
      p1: [RED5],
      p2: [BLUE5],
      p3: [RED5],
    },
    unoDrawPile: [],
    unoDiscardPile: [{ c: 'green', t: 'num', v: '3' }],
    unoCurrentColor: 'green',
    unoPenaltyAccum: 0,
    unoSaid: {},
  };
}

/**
 * 「本物」のゲームをそのまま進行させながら、並行して actionLog も組み立てる。
 * ここで使っている apply* 関数は ReplayEngine が内部で使うものと全く同じ。
 */
function playRealGameAndBuildLog(initialState) {
  const g = JSON.parse(JSON.stringify(initialState));
  const actionLog = [];
  let trumpPassCount = 0;

  // p1: トランプ♠7を出す（場は空なので何でも出せる）
  {
    const result = applyTrumpPlay(g, 'p1', ['♠7'], 'Alice');
    expect(result).not.toBeNull();
    trumpPassCount = 0;
    actionLog.push(makeActionLogEntry('trumpPlay', 'p1', { cardIds: ['♠7'] }));
  }

  // p1: UNOを引く（場は green の 3 なので、赤5は色も数字も一致せず出せない）
  {
    const { logMsg } = applyUnoDraw(g, 'p1', 'Alice');
    expect(logMsg).toContain('1枚');
    actionLog.push(makeActionLogEntry('unoDraw', 'p1', {}));
  }

  // p2: トランプ♥9は♠7より強いので出せる
  {
    const result = applyTrumpPlay(g, 'p2', ['♥9'], 'Bob');
    expect(result).not.toBeNull();
    trumpPassCount = 0;
    actionLog.push(makeActionLogEntry('trumpPlay', 'p2', { cardIds: ['♥9'] }));
  }

  // p2: UNOを引く
  {
    applyUnoDraw(g, 'p2', 'Bob');
    actionLog.push(makeActionLogEntry('unoDraw', 'p2', {}));
  }

  // p3: トランプは♦6しかなく♥9より弱いのでパス
  {
    const passCount = trumpPassCount + 1;
    applyTrumpPass(g, 'p3', 'Carol');
    const passResult = checkAllPassed(g, passCount, PLAYERS);
    trumpPassCount = passResult.cleared ? 0 : passCount;
    actionLog.push(makeActionLogEntry('trumpPass', 'p3', {}));
  }

  // p3: UNOを引く
  {
    applyUnoDraw(g, 'p3', 'Carol');
    actionLog.push(makeActionLogEntry('unoDraw', 'p3', {}));
  }

  return { finalGame: g, actionLog };
}

describe('ReplayEngine', () => {
  it('actionLogを最後まで再生すると、実際のゲーム進行と同じ最終状態になる', () => {
    const initialState = makeInitialState();
    const { finalGame, actionLog } = playRealGameAndBuildLog(initialState);

    const replay = {
      version: 1,
      roomId: 'TEST',
      players: PLAYERS,
      initialState,
      actionLog,
      savedAt: Date.now(),
    };

    const engine = new ReplayEngine(replay);
    while (engine.stepForward()) {
      // 最後まで進める
    }

    expect(engine.currentIndex).toBe(actionLog.length);
    // 手札・場・手番など、ゲームロジックが実際に書き換えたフィールドが一致すること
    expect(engine.currentGame.trumpHands).toEqual(finalGame.trumpHands);
    expect(engine.currentGame.trumpField).toEqual(finalGame.trumpField);
    expect(engine.currentGame.unoHands).toEqual(finalGame.unoHands);
    expect(engine.currentGame.ci).toBe(finalGame.ci);
    expect(engine.currentGame.phase).toBe(finalGame.phase);
  });

  it('goTo() で途中の手数までだけ進められる', () => {
    const initialState = makeInitialState();
    const { actionLog } = playRealGameAndBuildLog(initialState);
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });

    engine.goTo(2); // 最初の2手だけ再生
    expect(engine.currentIndex).toBe(2);
    // p1のトランプはもう出ているので手札は空のはず
    expect(engine.currentGame.trumpHands.p1).toEqual([]);
    // p3はまだ何もしていないので手札はそのまま
    expect(engine.currentGame.trumpHands.p3).toEqual([{ s: '♦', v: '6', id: '♦6' }]);
  });

  it('stepBackward() は1手戻り、その後 stepForward() で再び同じ状態に進める', () => {
    const initialState = makeInitialState();
    const { actionLog } = playRealGameAndBuildLog(initialState);
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });

    engine.goTo(3);
    const snapshotAt3 = JSON.parse(JSON.stringify(engine.currentGame));

    engine.stepBackward();
    expect(engine.currentIndex).toBe(2);

    engine.stepForward();
    expect(engine.currentIndex).toBe(3);
    expect(engine.currentGame).toEqual(snapshotAt3);
  });

  it('reset() で初期状態・ログ・カーソルがすべて0に戻る', () => {
    const initialState = makeInitialState();
    const { actionLog } = playRealGameAndBuildLog(initialState);
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });

    engine.goTo(4);
    engine.reset();

    expect(engine.currentIndex).toBe(0);
    expect(engine.currentLog).toEqual([]);
    expect(engine.currentGame).toEqual(initialState);
  });

  it('totalSteps は actionLog の長さと一致する', () => {
    const initialState = makeInitialState();
    const { actionLog } = playRealGameAndBuildLog(initialState);
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });
    expect(engine.totalSteps).toBe(actionLog.length);
  });

  it('actionLogが空でも例外にならず、stepForwardはfalseを返す', () => {
    const initialState = makeInitialState();
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog: [], savedAt: Date.now(),
    });
    expect(engine.stepForward()).toBe(false);
    expect(engine.currentGame).toEqual(initialState);
  });
});

// ========================================
// ★ヨットモード★ 対決の再生
//
// 対決でゲーム状態が変わるのは「決着を閉じた瞬間（敗者がUNOを引く）」だけ。
// これが actionLog に記録されていないと、再生時に敗者の手札が4枚少ないまま
// となり、以降の unoPlay(cardIdx) が別のカードを指してリプレイ全体がズレる。
// ここでも「本物の applyDuelPenalty を呼んだ結果」と再生結果を突き合わせる。
// ========================================
describe('ReplayEngine — ヨット対決（yachtDuel）', () => {
  const YD = (over = {}) => ({
    attackerId: 'p1', defenderId: 'p2', result: 'attacker',
    loserId: 'p2', penalty: 4,
    attackerDice: [6, 6, 6, 6, 6], defenderDice: [1, 2, 3, 5, 5],
    attackerBest: { category: 'yacht', score: 50 },
    defenderBest: { category: '5', score: 10 },
    ...over,
  });

  /** 山札を潤沢に持たせた初期状態（reshuffle=乱数を踏まないようにする） */
  function stateWithPile() {
    const s = makeInitialState();
    s.unoDrawPile = Array.from({ length: 12 }, (_, i) => ({ c: 'green', t: 'num', v: String(i % 10) }));
    return s;
  }

  it('敗者はUNOを4枚引き、山札もその分減る（本物の適用結果と一致）', () => {
    const initialState = stateWithPile();

    // 「本物」の進行: applyDuelPenalty を直接呼ぶ（yacht-actions と同じ関数）
    const real = JSON.parse(JSON.stringify(initialState));
    applyDuelPenalty(real, 'p2', 'Bob', 4);

    // 再生: yachtDuel エントリ1件を ReplayEngine に流す
    const actionLog = [makeActionLogEntry('yachtDuel', 'p1', YD())];
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });
    engine.stepForward();

    expect(engine.currentGame.unoHands.p2).toEqual(real.unoHands.p2);
    expect(engine.currentGame.unoHands.p2).toHaveLength(5); // 元1枚 + 4枚
    expect(engine.currentGame.unoDrawPile).toEqual(real.unoDrawPile);
    expect(engine.currentGame.unoDrawPile).toHaveLength(8);
  });

  it('対決の内容と結果がログに残る（役名・点数・勝者）', () => {
    const initialState = stateWithPile();
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState,
      actionLog: [makeActionLogEntry('yachtDuel', 'p1', YD())], savedAt: Date.now(),
    });
    engine.stepForward();
    const log = engine.currentLog.join('\n');
    expect(log).toContain('ヨット対決');
    expect(log).toContain('Alice');
    expect(log).toContain('ヨット50点');
    expect(log).toContain('Alice の勝ち！');
    expect(log).toContain('Bob は敗北ペナルティでUNOを4枚引いた！');
  });

  it('引き分けは誰も引かない（状態が変わらない）', () => {
    const initialState = stateWithPile();
    const actionLog = [makeActionLogEntry('yachtDuel', 'p1', YD({ result: 'draw', loserId: null }))];
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });
    engine.stepForward();
    expect(engine.currentGame.unoHands).toEqual(initialState.unoHands);
    expect(engine.currentGame.unoDrawPile).toEqual(initialState.unoDrawPile);
    expect(engine.currentLog.join('\n')).toContain('引き分け');
  });

  it('UNOを上がっていた敗者は4枚引いて復帰する', () => {
    const initialState = stateWithPile();
    initialState.unoHands.p2 = []; // p2はUNO側を上がり済み
    const actionLog = [makeActionLogEntry('yachtDuel', 'p1', YD())];
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });
    engine.stepForward();
    expect(engine.currentGame.unoHands.p2).toHaveLength(4);
    expect(engine.currentLog.join('\n')).toContain('復帰');
  });

  it('★退行防止★ 対決後もカード添字がズレない（記録が無いと崩れる箇所）', () => {
    // 敗者p2が4枚引いた後、p2が「引いた4枚のうちの1枚」を出すシナリオ。
    // yachtDuel が記録されていないと手札の中身が変わり、同じ cardIdx が
    // 別のカードを指してしまう＝リプレイが実際と食い違う。
    const initialState = stateWithPile();

    // 本物の進行
    const real = JSON.parse(JSON.stringify(initialState));
    applyDuelPenalty(real, 'p2', 'Bob', 4);
    const idx = real.unoHands.p2.length - 1;          // 最後に引いたカード
    const expectedCard = real.unoHands.p2[idx];
    applyUnoPlay(real, 'p2', idx, null, 'Bob');

    // 再生（yachtDuel あり）
    const actionLog = [
      makeActionLogEntry('yachtDuel', 'p1', YD()),
      makeActionLogEntry('unoPlay', 'p2', { cardIdx: idx, chosenColor: null }),
    ];
    const engine = new ReplayEngine({
      version: 1, roomId: 'TEST', players: PLAYERS, initialState, actionLog, savedAt: Date.now(),
    });
    engine.goTo(2);

    // 場に出たカードが本物と一致＝添字がズレていない
    const top = engine.currentGame.unoDiscardPile[engine.currentGame.unoDiscardPile.length - 1];
    expect(top).toEqual(expectedCard);
    expect(engine.currentGame.unoHands.p2).toEqual(real.unoHands.p2);
  });
});
