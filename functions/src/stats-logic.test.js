// ========================================
// stats-logic.ts 単体テスト（戦績集計の純粋ロジック）
// ========================================
import { describe, it, expect } from 'vitest';
import { applyGameResult, rankScore, RECENT_MAX } from './stats-logic.ts';

const g = (rank, at = 1000, hasBots = false, playerCount = 4) =>
  ({ rank, playerCount, at, hasBots });

describe('rankScore — 順位の正規化スコア', () => {
  it('1位=100・最下位=0・線形補間', () => {
    expect(rankScore(1, 3)).toBe(100);
    expect(rankScore(2, 3)).toBe(50);
    expect(rankScore(3, 3)).toBe(0);
    expect(rankScore(2, 4)).toBeCloseTo(66.666, 2);
    expect(rankScore(3, 4)).toBeCloseTo(33.333, 2);
  });

  it('全順位の平均はちょうど50（3〜8人）', () => {
    for (let n = 3; n <= 8; n++) {
      let sum = 0;
      for (let r = 1; r <= n; r++) sum += rankScore(r, n);
      expect(sum / n).toBeCloseTo(50, 6);
    }
  });

  it('人数2未満は0除算せず50を返す（想定外の防御）', () => {
    expect(rankScore(1, 1)).toBe(50);
  });
});

describe('applyGameResult — 戦績集計', () => {
  it('初回（prev=null）の1位: 1勝・連勝1・humanバケットに集計', () => {
    const s = applyGameResult(null, g(1));
    expect(s.games).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.winStreak).toBe(1);
    expect(s.loseStreak).toBe(0);
    expect(s.recent).toEqual([g(1)]);
    expect(s.human).toEqual({ games: 1, scoreSum: 100 });
    expect(s.withBots).toEqual({ games: 0, scoreSum: 0 });
  });

  it('ボット入りの卓は withBots バケットへ（human は増えない）', () => {
    const s = applyGameResult(null, g(2, 1, true));
    expect(s.withBots.games).toBe(1);
    expect(s.withBots.scoreSum).toBeCloseTo(66.666, 2);
    expect(s.human).toEqual({ games: 0, scoreSum: 0 });
  });

  it('human/withBots が混ざっても別々に積み上がる', () => {
    let s = applyGameResult(null, g(1, 1, false, 3)); // human: 100
    s = applyGameResult(s, g(3, 2, true, 3));         // bots: 0
    s = applyGameResult(s, g(2, 3, false, 3));        // human: +50
    expect(s.human.games).toBe(2);
    expect(s.human.scoreSum).toBeCloseTo(150, 6);     // 平均75
    expect(s.withBots.games).toBe(1);
    expect(s.withBots.scoreSum).toBeCloseTo(0, 6);
    expect(s.games).toBe(3); // 全体は合算
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

  it('recent は新しい順・最大5件で hasBots も保持する', () => {
    let s = null;
    for (let i = 1; i <= 7; i++) s = applyGameResult(s, g(i <= 3 ? 1 : 2, i, i % 2 === 0));
    expect(s.recent).toHaveLength(RECENT_MAX);
    expect(s.recent[0].at).toBe(7);
    expect(s.recent[4].at).toBe(3);
    expect(s.recent[1].hasBots).toBe(true); // at=6 は偶数=ボット入り
  });

  it('旧形式データ（human/withBots無し）も自己修復して集計を始める', () => {
    const legacy = { games: 10, wins: 4, winStreak: 2, loseStreak: 0, recent: [] };
    const s = applyGameResult(legacy, g(1, 99));
    expect(s.games).toBe(11);            // 全体は継続
    expect(s.human).toEqual({ games: 1, scoreSum: 100 }); // バケットは今回から
  });

  it('壊れた既存データ（文字列・負数・recent非配列）は0扱いで自己修復する', () => {
    const s = applyGameResult(
      { games: 'x', wins: -5, winStreak: null, loseStreak: undefined, recent: 'oops',
        human: { games: 'bad', scoreSum: -1 } },
      g(1)
    );
    expect(s.games).toBe(1);
    expect(s.wins).toBe(1);
    expect(s.human).toEqual({ games: 1, scoreSum: 100 });
  });

  it('入力の prev を変更しない（純粋関数）', () => {
    const prev = { games: 1, wins: 1, winStreak: 1, loseStreak: 0, recent: [g(1, 1)],
      human: { games: 1, scoreSum: 100 }, withBots: { games: 0, scoreSum: 0 } };
    const copy = JSON.parse(JSON.stringify(prev));
    applyGameResult(prev, g(2, 2));
    expect(prev).toEqual(copy);
  });
});
