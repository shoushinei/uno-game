// ========================================
// stats-logic.ts 単体テスト（戦績集計の純粋ロジック）
// ========================================
import { describe, it, expect } from 'vitest';
import { applyGameResult, RECENT_MAX } from './stats-logic.ts';

const g = (rank, at = 1000) => ({ rank, playerCount: 4, at });

describe('applyGameResult — 戦績集計', () => {
  it('初回（prev=null）の1位: 1勝・連勝1', () => {
    const s = applyGameResult(null, g(1));
    expect(s).toEqual({
      games: 1, wins: 1, winStreak: 1, loseStreak: 0,
      recent: [g(1)],
    });
  });

  it('初回の2位: 0勝・連敗1', () => {
    const s = applyGameResult(null, g(2));
    expect(s.games).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.winStreak).toBe(0);
    expect(s.loseStreak).toBe(1);
  });

  it('連勝が続き、負けたらリセットして連敗が始まる', () => {
    let s = applyGameResult(null, g(1, 1));
    s = applyGameResult(s, g(1, 2));
    s = applyGameResult(s, g(1, 3));
    expect(s.winStreak).toBe(3);
    expect(s.wins).toBe(3);
    s = applyGameResult(s, g(3, 4));
    expect(s.winStreak).toBe(0);
    expect(s.loseStreak).toBe(1);
    expect(s.wins).toBe(3);
    expect(s.games).toBe(4);
  });

  it('連敗から勝つと連敗リセット・連勝1', () => {
    let s = applyGameResult(null, g(4, 1));
    s = applyGameResult(s, g(2, 2));
    expect(s.loseStreak).toBe(2);
    s = applyGameResult(s, g(1, 3));
    expect(s.loseStreak).toBe(0);
    expect(s.winStreak).toBe(1);
  });

  it('recent は新しい順・最大5件', () => {
    let s = null;
    for (let i = 1; i <= 7; i++) s = applyGameResult(s, g(i <= 3 ? 1 : 2, i));
    expect(s.recent).toHaveLength(RECENT_MAX);
    expect(s.recent[0].at).toBe(7); // 最新が先頭
    expect(s.recent[4].at).toBe(3); // 6以前は押し出される
  });

  it('壊れた既存データ（文字列・負数・recent非配列）は0扱いで自己修復する', () => {
    const s = applyGameResult(
      { games: 'x', wins: -5, winStreak: null, loseStreak: undefined, recent: 'oops' },
      g(1)
    );
    expect(s).toEqual({
      games: 1, wins: 1, winStreak: 1, loseStreak: 0, recent: [g(1)],
    });
  });

  it('入力の prev を変更しない（純粋関数）', () => {
    const prev = { games: 1, wins: 1, winStreak: 1, loseStreak: 0, recent: [g(1, 1)] };
    const copy = JSON.parse(JSON.stringify(prev));
    applyGameResult(prev, g(2, 2));
    expect(prev).toEqual(copy);
  });
});
