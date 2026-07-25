// ========================================
// mobile-action-bar.ts 単体テスト
//
// syncMobileActionBar は DOM/getComputedStyle に依存するため vitest では
// 読めない。判定そのもの（中身が空か）を純粋関数に切り出してある。
// ========================================
import { describe, it, expect } from 'vitest';
import { isBarEmpty } from './mobile-action-bar.js';

describe('isBarEmpty', () => {
  it('すべて none ならバーは空', () => {
    expect(isBarEmpty(['none', 'none', 'none'])).toBe(true);
  });

  it('1つでも表示されていれば空ではない', () => {
    expect(isBarEmpty(['none', 'inline-block', 'none'])).toBe(false);
    expect(isBarEmpty(['block', 'none'])).toBe(false);
  });

  it('色ピッカーだけ開いている状態も空ではない（flexで表示される）', () => {
    expect(isBarEmpty(['none', 'none', 'flex'])).toBe(false);
  });

  it('子要素が無い場合は空とみなす', () => {
    expect(isBarEmpty([])).toBe(true);
  });
});
