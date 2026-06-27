// ========================================
// game-rules.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest'; 
import {
  checkAllPassed,
  resolveRankingNames,
  applyTrumpSkip,
  applyParentColorChange,
  applyUnoDeclaration,
} from './game-rules.js';

// ---- テスト対象のゲーム状態ファクトリ ----
function makeGame(overrides = {}) {
  return {
    order: ['p1', 'p2', 'p3'],
    ci: 0,
    dir: 1,
    phase: 'trump',
    trumpField: [{ s: '♠', v: '5', id: '♠5' }],
    hasParent: null,
    unoCurrentColor: 'red',
    unoSaid: {},
    ...overrides,
  };
}

const PLAYERS = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
];

// ========================================
// checkAllPassed のテスト
// ========================================
describe('checkAllPassed', () => {
  it('場が空のときは cleared=false を返す', () => {
    const g = makeGame({ trumpField: [] });
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(r.cleared).toBe(false);
  });

  it('passCount が order.length-1 未満なら cleared=false', () => {
    const g = makeGame();
    const r = checkAllPassed(g, 1, PLAYERS); // 3人なので閾値は2
    expect(r.cleared).toBe(false);
  });

  it('passCount === order.length-1 で cleared=true', () => {
    const g = makeGame();
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(r.cleared).toBe(true);
  });

  it('cleared 時に場が流れて trumpField が空になる', () => {
    const g = makeGame();
    checkAllPassed(g, 2, PLAYERS);
    expect(g.trumpField).toEqual([]);
  });

  it('cleared 時に現在の ci プレイヤーが親になる（ci=0 → p1=Alice）', () => {
    const g = makeGame({ ci: 0 });
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(g.hasParent).toBe('p1');
    expect(r.parentName).toBe('Alice');
  });

  it('cleared 時に ci=2 なら Carol が親になる', () => {
    const g = makeGame({ ci: 2 });
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(g.hasParent).toBe('p3');
    expect(r.parentName).toBe('Carol');
  });

  it('logMsg に親の名前が含まれる', () => {
    const g = makeGame({ ci: 1 });
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(r.logMsg).toContain('Bob');
  });
});

// ========================================
// resolveRankingNames のテスト
// ========================================
describe('resolveRankingNames', () => {
  it('名前が ? のエントリを実名に解決する', () => {
    const rankings = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: '?' }];
    resolveRankingNames(rankings, PLAYERS);
    expect(rankings[1].name).toBe('Bob');
  });

  it('すでに実名のエントリは変更しない', () => {
    const rankings = [{ id: 'p1', name: 'Alice' }];
    resolveRankingNames(rankings, PLAYERS);
    expect(rankings[0].name).toBe('Alice');
  });

  it('対応するプレイヤーが見つからない場合は ? のまま', () => {
    const rankings = [{ id: 'unknown', name: '?' }];
    resolveRankingNames(rankings, PLAYERS);
    expect(rankings[0].name).toBe('?');
  });
});

// ========================================
// applyTrumpSkip のテスト
// ========================================
describe('applyTrumpSkip', () => {
  it('phase が uno になる', () => {
    const g = makeGame({ phase: 'trump' });
    applyTrumpSkip(g, 'Alice');
    expect(g.phase).toBe('uno');
  });

  it('logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame({ phase: 'trump' });
    const { logMsg } = applyTrumpSkip(g, 'Bob');
    expect(logMsg).toContain('Bob');
  });
});

// ========================================
// applyParentColorChange のテスト
// ========================================
describe('applyParentColorChange', () => {
  it('親でなければ null を返す', () => {
    const g = makeGame({ hasParent: 'p2' });
    const r = applyParentColorChange(g, 'p1', 'blue', 'Alice');
    expect(r).toBeNull();
  });

  it('色が更新される', () => {
    const g = makeGame({ hasParent: 'p1', unoCurrentColor: 'red' });
    applyParentColorChange(g, 'p1', 'blue', 'Alice');
    expect(g.unoCurrentColor).toBe('blue');
  });

  it('実行後 hasParent が null になる', () => {
    const g = makeGame({ hasParent: 'p1' });
    applyParentColorChange(g, 'p1', 'green', 'Alice');
    expect(g.hasParent).toBeNull();
  });

  it('logMsg に色名（日本語）が含まれる', () => {
    const g = makeGame({ hasParent: 'p1' });
    const r = applyParentColorChange(g, 'p1', 'yellow', 'Alice');
    expect(r.logMsg).toContain('黄');
  });
});

// ========================================
// applyUnoDeclaration のテスト
// ========================================
describe('applyUnoDeclaration', () => {
  it('unoSaid に playerId が記録される', () => {
    const g = makeGame({ unoSaid: {} });
    applyUnoDeclaration(g, 'p1', 'Alice');
    expect(g.unoSaid['p1']).toBeTruthy();
  });

  it('logMsg に「UNO！」が含まれる', () => {
    const g = makeGame({ unoSaid: {} });
    const { logMsg } = applyUnoDeclaration(g, 'p1', 'Alice');
    expect(logMsg).toContain('UNO！');
  });

  it('unoSaid が undefined でも動作する', () => {
    const g = makeGame({ unoSaid: undefined });
    applyUnoDeclaration(g, 'p2', 'Bob');
    expect(g.unoSaid['p2']).toBeTruthy();
  });
});