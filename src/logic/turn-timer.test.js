// ========================================
// turn-timer.ts 単体テスト（手番キー・残り秒数・強制種別）
// ========================================
import { describe, it, expect } from 'vitest';
import {
  TURN_LIMIT_MS, turnKey, duelKey, remainingSec, deadlineActive,
  timeoutKind, duelTimeoutMove,
} from './turn-timer.ts';

const mkRoom = (over = {}) => ({
  state: 'playing',
  actionLog: [{}, {}, {}],
  game: { order: ['a', 'b', 'c'], ci: 0, phase: 'trump', ...(over.game || {}) },
  ...over,
});

const mkDuel = (over = {}) => ({
  attackerId: 'a', defenderId: 'b', turn: 'attacker', stage: 'rolling',
  attacker: { dice: [1, 2, 3, 4, 5], rollsLeft: 2, done: false, best: null },
  defender: { dice: [], rollsLeft: 3, done: false, best: null },
  result: null, winnerId: null, startedAt: 100,
  ...over,
});

describe('TURN_LIMIT_MS', () => {
  it('当面は60秒', () => {
    expect(TURN_LIMIT_MS).toBe(60_000);
  });
});

describe('turnKey', () => {
  it('actionLog長:手番index:フェイズ で構成される', () => {
    expect(turnKey(mkRoom())).toBe('3:0:trump');
  });
  it('フェイズや手番が変わるとキーも変わる', () => {
    const a = turnKey(mkRoom());
    const b = turnKey(mkRoom({ game: { order: ['a', 'b', 'c'], ci: 0, phase: 'uno' } }));
    const c = turnKey(mkRoom({ game: { order: ['a', 'b', 'c'], ci: 1, phase: 'trump' } }));
    const d = turnKey(mkRoom({ actionLog: [{}, {}, {}, {}] }));
    expect(new Set([a, b, c, d]).size).toBe(4);
  });
  it('ゲーム未進行・対決中・手番なしは null', () => {
    expect(turnKey(mkRoom({ state: 'lobby' }))).toBeNull();
    expect(turnKey(mkRoom({ duel: mkDuel() }))).toBeNull();
    expect(turnKey({ state: 'playing' })).toBeNull();
    expect(turnKey(mkRoom({ game: { order: [], ci: 0, phase: 'trump' } }))).toBeNull();
  });
});

describe('duelKey', () => {
  it('開始時刻:振る側:残り振り回数 で構成される', () => {
    expect(duelKey(mkDuel())).toBe('100:attacker:2');
  });
  it('振り直し・攻守交代でキーが変わる', () => {
    const base = duelKey(mkDuel());
    const rerolled = duelKey(mkDuel({ attacker: { dice: [1, 1, 1, 1, 1], rollsLeft: 1, done: false, best: null } }));
    const def = duelKey(mkDuel({ turn: 'defender' }));
    expect(new Set([base, rerolled, def]).size).toBe(3);
  });
  it('rolling でなければ null', () => {
    expect(duelKey(mkDuel({ stage: 'done' }))).toBeNull();
    expect(duelKey(null)).toBeNull();
  });
});

describe('remainingSec', () => {
  it('切り上げ・0未満は0', () => {
    expect(remainingSec(10_000, 0)).toBe(10);
    expect(remainingSec(10_500, 0)).toBe(11); // 切り上げ
    expect(remainingSec(1_000, 5_000)).toBe(0); // 過ぎたら0
  });
  it('無効な deadline は null', () => {
    expect(remainingSec(null, 0)).toBeNull();
    expect(remainingSec(undefined, 0)).toBeNull();
  });
});

describe('deadlineActive', () => {
  it('現在キーと保存キーが一致するときだけ有効', () => {
    expect(deadlineActive('3:0:trump', '3:0:trump')).toBe(true);
    expect(deadlineActive('3:0:trump', '3:0:uno')).toBe(false); // 刻み待ち
    expect(deadlineActive(null, '3:0:trump')).toBe(false); // 手番なし
    expect(deadlineActive('3:0:trump', null)).toBe(false); // 未刻み
  });
});

describe('timeoutKind', () => {
  it('トランプフェイズは trump-pass', () => {
    expect(timeoutKind(mkRoom(), 'a')).toBe('trump-pass');
  });
  it('UNOフェイズは uno-draw', () => {
    expect(timeoutKind(mkRoom({ game: { order: ['a', 'b', 'c'], ci: 0, phase: 'uno' } }), 'a')).toBe('uno-draw');
  });
  it('現在の手番でなければ null', () => {
    expect(timeoutKind(mkRoom(), 'b')).toBeNull();
  });
  it('対決中・非playing は null', () => {
    expect(timeoutKind(mkRoom({ duel: mkDuel() }), 'a')).toBeNull();
    expect(timeoutKind(mkRoom({ state: 'ended' }), 'a')).toBeNull();
  });
});

describe('duelTimeoutMove', () => {
  it('未振り（dice空）は roll', () => {
    const d = mkDuel({ turn: 'defender' }); // defender は dice 空
    expect(duelTimeoutMove(d)).toEqual({ type: 'roll' });
  });
  it('振っていれば commit（現在の持ちサイコロで確定）', () => {
    expect(duelTimeoutMove(mkDuel())).toEqual({ type: 'commit' });
  });
  it('rolling でなければ null', () => {
    expect(duelTimeoutMove(mkDuel({ stage: 'done' }))).toBeNull();
    expect(duelTimeoutMove(null)).toBeNull();
  });
});
