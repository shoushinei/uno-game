// ========================================
// haptics.ts 単体テスト
//
// 実際に振動させる部分（navigator.vibrate）はブラウザ依存なので、
// 検証できるのは「パターン表の健全性」と「出来事→振動の対応」。
// 壊れると困るのは後者 ―― ★他人の操作で振動してはいけない★ という
// 設計上の約束で、ここが崩れるとボット戦で鳴りっぱなしになる。
// ========================================
import { describe, it, expect } from 'vitest';
import { HAPTIC_PATTERNS, hapticForEffect } from './haptics.js';

const ME = 'me-uid';
const OTHER = 'other-uid';

// ----------------------------------------
// パターン表の健全性
// ----------------------------------------
describe('HAPTIC_PATTERNS', () => {
  const entries = Object.entries(HAPTIC_PATTERNS);

  it('すべて正の数、または正の数の配列', () => {
    for (const [id, p] of entries) {
      const arr = Array.isArray(p) ? p : [p];
      expect(arr.length, `${id} が空`).toBeGreaterThan(0);
      for (const n of arr) {
        expect(typeof n, `${id} に数値以外`).toBe('number');
        expect(n, `${id} に0以下の値`).toBeGreaterThan(0);
      }
    }
  });

  it('1回の振動は150ms以下（長すぎると持っているだけで不快）', () => {
    for (const [id, p] of entries) {
      const arr = Array.isArray(p) ? p : [p];
      // 配列は [振動, 停止, 振動, ...] なので偶数番だけが振動時間
      for (let i = 0; i < arr.length; i += 2) {
        expect(arr[i], `${id} の振動が長すぎる`).toBeLessThanOrEqual(150);
      }
    }
  });

  it('合計時間は500ms以下に収める', () => {
    for (const [id, p] of entries) {
      const arr = Array.isArray(p) ? p : [p];
      const total = arr.reduce((a, b) => a + b, 0);
      expect(total, `${id} の合計が長すぎる`).toBeLessThanOrEqual(500);
    }
  });

  it('my-turn は tap よりはっきり長い（合図として埋もれさせない）', () => {
    const t = HAPTIC_PATTERNS.tap;
    const m = HAPTIC_PATTERNS['my-turn'];
    const total = (x) => (Array.isArray(x) ? x.reduce((a, b) => a + b, 0) : x);
    expect(total(m)).toBeGreaterThan(total(t) * 3);
  });
});

// ----------------------------------------
// 出来事 → 振動の対応
// ----------------------------------------
describe('hapticForEffect', () => {
  it('自分の操作は振動する', () => {
    expect(hapticForEffect({ kind: 'trump-play', playerId: ME, cards: [] }, ME)).toBe('tap');
    expect(hapticForEffect({ kind: 'uno-play', playerId: ME, card: null }, ME)).toBe('tap');
    expect(hapticForEffect({ kind: 'draw', playerId: ME, count: 1 }, ME)).toBe('tap');
    expect(hapticForEffect({ kind: 'say-uno', playerId: ME }, ME)).toBe('double');
    expect(hapticForEffect({ kind: 'finish', playerId: ME, rank: 1 }, ME)).toBe('finish');
    expect(
      hapticForEffect({ kind: 'trump-special', playerId: ME, types: ['eightCut'], revolutionOn: false }, ME)
    ).toBe('strong');
  });

  // ★これが崩れるとボット戦で振動が鳴りっぱなしになる★
  it('他人の操作では一切振動しない', () => {
    const descs = [
      { kind: 'trump-play', playerId: OTHER, cards: [] },
      { kind: 'uno-play', playerId: OTHER, card: null },
      { kind: 'draw', playerId: OTHER, count: 2 },
      { kind: 'say-uno', playerId: OTHER },
      { kind: 'finish', playerId: OTHER, rank: 1 },
      { kind: 'trump-special', playerId: OTHER, types: ['revolution'], revolutionOn: true },
    ];
    for (const d of descs) {
      expect(hapticForEffect(d, ME), `${d.kind} で他人なのに振動した`).toBeNull();
    }
  });

  it('プレイヤー不特定の出来事では振動しない', () => {
    expect(hapticForEffect({ kind: 'game-start', firstPlayerName: 'a', seatIds: [] }, ME)).toBeNull();
    expect(hapticForEffect({ kind: 'reverse', dir: -1 }, ME)).toBeNull();
    expect(hapticForEffect({ kind: 'field-clear', parentId: null }, ME)).toBeNull();
    expect(hapticForEffect({ kind: 'pass', playerId: ME }, ME)).toBeNull();
  });

  it('自分のIDが無い（未参加・観戦）ときは振動しない', () => {
    expect(hapticForEffect({ kind: 'trump-play', playerId: ME, cards: [] }, null)).toBeNull();
  });

  it('返す振動IDは必ずパターン表に存在する', () => {
    const ids = [
      hapticForEffect({ kind: 'trump-play', playerId: ME, cards: [] }, ME),
      hapticForEffect({ kind: 'say-uno', playerId: ME }, ME),
      hapticForEffect({ kind: 'finish', playerId: ME, rank: 1 }, ME),
      hapticForEffect({ kind: 'trump-special', playerId: ME, types: ['joker'], revolutionOn: false }, ME),
    ];
    for (const id of ids) {
      expect(HAPTIC_PATTERNS[id], `${id} がパターン表に無い`).toBeDefined();
    }
  });
});
