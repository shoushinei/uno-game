// ========================================
// friends.ts の純粋関数テスト（pairId / generateCode）
// ========================================
import { describe, it, expect } from 'vitest';
import { pairId, generateCode } from './friends-util.ts';

describe('pairId — 順不同で同じID', () => {
  it('引数の順番によらず同じ値になる', () => {
    expect(pairId('alice', 'bob')).toBe(pairId('bob', 'alice'));
  });
  it('ソートして _ で連結する', () => {
    expect(pairId('bob', 'alice')).toBe('alice_bob');
  });
  it('異なるペアは異なるID', () => {
    expect(pairId('a', 'b')).not.toBe(pairId('a', 'c'));
  });
});

describe('generateCode — フレンドコード生成', () => {
  it('6文字', () => {
    expect(generateCode()).toHaveLength(6);
  });
  it('紛らわしい文字(0/O/1/I)を含まない', () => {
    let all = '';
    const seq = [0, 0.03, 0.06, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.99];
    let i = 0;
    for (let n = 0; n < 200; n++) all += generateCode(() => seq[i++ % seq.length]);
    expect(all).not.toMatch(/[01OI]/);
  });
  it('乱数源で決定的に作れる（先頭固定rand）', () => {
    expect(generateCode(() => 0)).toBe('AAAAAA');
  });
});
