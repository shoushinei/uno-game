// ========================================
// replay-log.ts 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import { makeActionLogEntry, appendActionLog } from './log.js';

describe('makeActionLogEntry', () => {
  it('type / playerId / args をそのまま保持する', () => {
    const entry = makeActionLogEntry('trumpPlay', 'p1', { cardIds: ['♠5'] });
    expect(entry.type).toBe('trumpPlay');
    expect(entry.playerId).toBe('p1');
    expect(entry.args).toEqual({ cardIds: ['♠5'] });
  });

  it('ts に数値のタイムスタンプが入る', () => {
    const entry = makeActionLogEntry('trumpPass', 'p1', {});
    expect(typeof entry.ts).toBe('number');
    expect(entry.ts).toBeGreaterThan(0);
  });
});

describe('appendActionLog', () => {
  it('room.actionLog が配列なら1件追記した新しい配列を返す', () => {
    const room = { actionLog: [] };
    const entry = makeActionLogEntry('trumpPass', 'p1', {});
    const result = appendActionLog(room, entry);
    expect(result).toEqual([entry]);
  });

  it('room.actionLog が既存の配列を破壊的に変更しない', () => {
    const original = [makeActionLogEntry('trumpPass', 'p1', {})];
    const room = { actionLog: original };
    const entry = makeActionLogEntry('unoDraw', 'p2', {});
    const result = appendActionLog(room, entry);
    expect(result.length).toBe(2);
    expect(original.length).toBe(1); // 元の配列は変更されていないこと
  });

  it('room.actionLog が undefined なら null を返す（古いルームとの互換性）', () => {
    const room = {};
    const result = appendActionLog(room, makeActionLogEntry('trumpPass', 'p1', {}));
    expect(result).toBeNull();
  });

  it('room.actionLog が null なら null を返す', () => {
    const room = { actionLog: null };
    const result = appendActionLog(room, makeActionLogEntry('trumpPass', 'p1', {}));
    expect(result).toBeNull();
  });

  it('複数回連続で追記すると順番通りに積み上がる', () => {
    let room = { actionLog: [] };
    const e1 = makeActionLogEntry('trumpPlay', 'p1', { cardIds: ['♠5'] });
    room = { actionLog: appendActionLog(room, e1) };
    const e2 = makeActionLogEntry('unoDraw', 'p2', {});
    room = { actionLog: appendActionLog(room, e2) };
    expect(room.actionLog.map(e => e.type)).toEqual(['trumpPlay', 'unoDraw']);
  });

  it('安全弁：上限（2000件）に達すると以降は追記されず、元の配列がそのまま返る', () => {
    const bigLog = Array.from({ length: 2000 }, () => makeActionLogEntry('unoDraw', 'p1', {}));
    const room = { actionLog: bigLog };
    const result = appendActionLog(room, makeActionLogEntry('unoDraw', 'p1', {}));
    expect(result.length).toBe(2000);
    expect(result).toBe(bigLog); // 同じ参照（新しい配列を作らなかった）であること
  });
});
