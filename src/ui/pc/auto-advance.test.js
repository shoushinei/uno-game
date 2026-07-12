// ========================================
// auto-advance.ts 単体テスト（発火条件の判定）
// ========================================
import { describe, it, expect } from 'vitest';
import { shouldAutoAdvance } from './auto-advance.js';

function makeRoom(overrides = {}, gameOverrides = {}) {
  return {
    state: 'playing',
    autoPlayers: {},
    actionLog: [],
    game: {
      order: ['me', 'p2'],
      ci: 0,
      phase: 'trump',
      rankings: [],
      hasParent: null,
      trumpHands: { me: [], p2: [{ s: '♠', v: '5', id: '♠5' }] },
      unoHands: { me: [{ c: 'red', t: 'num', v: '5' }], p2: [] },
      ...gameOverrides,
    },
    ...overrides,
  };
}

describe('shouldAutoAdvance', () => {
  it('自分のトランプ手番で手札0枚なら trump', () => {
    expect(shouldAutoAdvance(makeRoom(), 'me')).toBe('trump');
  });

  it('自分のUNO手番で手札0枚なら uno', () => {
    const room = makeRoom({}, {
      phase: 'uno',
      trumpHands: { me: [{ s: '♠', v: '5', id: '♠5' }], p2: [] },
      unoHands: { me: [], p2: [] },
    });
    expect(shouldAutoAdvance(room, 'me')).toBe('uno');
  });

  it('手札が残っていれば発動しない', () => {
    const room = makeRoom({}, { trumpHands: { me: [{ s: '♠', v: '5', id: '♠5' }], p2: [] } });
    expect(shouldAutoAdvance(room, 'me')).toBeNull();
  });

  it('自分の手番でなければ発動しない', () => {
    expect(shouldAutoAdvance(makeRoom({}, { ci: 1 }), 'me')).toBeNull();
  });

  it('上がり済みなら発動しない', () => {
    const room = makeRoom({}, { rankings: [{ id: 'me', name: '自分' }] });
    expect(shouldAutoAdvance(room, 'me')).toBeNull();
  });

  it('自動プレイ(🐒)ON中はボットに任せて発動しない', () => {
    const room = makeRoom({ autoPlayers: { me: true } });
    expect(shouldAutoAdvance(room, 'me')).toBeNull();
  });

  it('親の権限を持つUNO手番では発動しない（色変更の機会を奪わない）', () => {
    const room = makeRoom({}, {
      phase: 'uno',
      hasParent: 'me',
      trumpHands: { me: [{ s: '♠', v: '5', id: '♠5' }], p2: [] },
      unoHands: { me: [], p2: [] },
    });
    expect(shouldAutoAdvance(room, 'me')).toBeNull();
  });

  it('Firebaseの空配列対策: trumpHands自体が無くても0枚扱いで発動する', () => {
    const room = makeRoom({}, { trumpHands: undefined });
    expect(shouldAutoAdvance(room, 'me')).toBe('trump');
  });

  it('ゲーム中でなければ発動しない', () => {
    expect(shouldAutoAdvance(makeRoom({ state: 'ended' }), 'me')).toBeNull();
    expect(shouldAutoAdvance({ state: 'playing' }, 'me')).toBeNull();
  });
});
