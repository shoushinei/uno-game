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
import { applyUnoDraw } from '../logic/uno-logic.js';
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
