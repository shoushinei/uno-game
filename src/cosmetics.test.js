// ========================================
// cosmetics.ts 単体テスト（解除判定）
// ========================================
import { describe, it, expect } from 'vitest';
import { ICONS, TITLES, isUnlocked, unlockedAchievementSet } from './cosmetics.ts';

describe('isUnlocked', () => {
  it('unlock=null の基本アイコンは常に選べる', () => {
    const base = ICONS.find(c => c.unlock === null);
    expect(isUnlocked(base, new Set())).toBe(true);
  });
  it('実績連動は該当実績を解除していれば選べる', () => {
    const crown = ICONS.find(c => c.value === '👑'); // first-win
    expect(isUnlocked(crown, new Set())).toBe(false);
    expect(isUnlocked(crown, new Set(['first-win']))).toBe(true);
  });
  it('称号はすべて実績連動', () => {
    expect(TITLES.every(t => t.unlock !== null)).toBe(true);
    const rev = TITLES.find(t => t.value === '革命家');
    expect(isUnlocked(rev, new Set(['revolution']))).toBe(true);
    expect(isUnlocked(rev, new Set(['eight-cut']))).toBe(false);
  });
});

describe('unlockedAchievementSet', () => {
  it('achievements マップのキーを集合にする', () => {
    const s = unlockedAchievementSet({ achievements: { 'first-win': 1, 'revolution': 2 } });
    expect(s.has('first-win')).toBe(true);
    expect(s.has('revolution')).toBe(true);
    expect(s.size).toBe(2);
  });
  it('reactedFirstAt があれば reaction-first を足す', () => {
    const s = unlockedAchievementSet({ achievements: {}, reactedFirstAt: 123 });
    expect(s.has('reaction-first')).toBe(true);
  });
  it('null/undefined でも空集合', () => {
    expect(unlockedAchievementSet(null).size).toBe(0);
    expect(unlockedAchievementSet(undefined).size).toBe(0);
  });
});
