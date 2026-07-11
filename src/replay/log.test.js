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

// ========================================
// ★バグ修正回帰テスト★ リプレイが1手も記録されないバグ
//
// Firebase RTDB は空配列を保存しない（キーごと消える）ため、
// actionStartGame で actionLog: [] と初期化しても、最初のアクションの
// 時点では room.actionLog は undefined になっている。
// 以前は「配列でなければ古いルーム」とみなして null を返していたため、
// アクションが永遠に1件も記録されず「📼 リプレイを保存」が常に失敗していた。
// リプレイ対応判定は replayInitialState の有無（Firebase上に必ず残る）で行う。
// ========================================
describe('appendActionLog — Firebase空配列対策（リプレイ未記録バグの回帰）', () => {
  it('actionLog が undefined でも replayInitialState があれば1件目を追記できる', () => {
    const room = { replayInitialState: { order: ['p1', 'p2', 'p3'] } };
    const entry = makeActionLogEntry('trumpPlay', 'p1', { cardIds: ['♠5'] });
    expect(appendActionLog(room, entry)).toEqual([entry]);
  });

  it('actionLog が null でも replayInitialState があれば1件目を追記できる', () => {
    const room = { actionLog: null, replayInitialState: { order: ['p1'] } };
    const entry = makeActionLogEntry('unoDraw', 'p2', {});
    expect(appendActionLog(room, entry)).toEqual([entry]);
  });

  it('replayInitialState も actionLog も無いルーム（真のリプレイ非対応）は従来通り null', () => {
    expect(appendActionLog({}, makeActionLogEntry('trumpPass', 'p1', {}))).toBeNull();
  });
});
