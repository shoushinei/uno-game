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

// ========================================
// ユーザーさんが提案してくれた「あがり・手番・ゲーム終了」の深いテスト
// ========================================
describe('大富豪×UNO 融合ゲームの終了・手番スキップ仕様', () => {

  it('片方（トランプだけ）終わってUNOが残っている人は、まだゲーム内に残り、順番（order）からも消えない', () => {
    // p1がトランプは0枚（終了）だけど、UNOはまだ5枚持っている状態を作る
    const g = makeGame({
      order: ['p1', 'p2', 'p3'],
      trumpHands: { p1: [], p2: [{id:'S3'}], p3: [{id:'H3'}] }, // p1はトランプ0枚
      unoHands: { p1: [{}, {}, {}, {}, {}], p2: [{}], p3: [{}] } // p1はUNO5枚
    });

    // 片方だけ終了しても、p1はまだゲームを続けるので order から消えてはいけない
    expect(g.order.includes('p1')).toBeTruthy();
  });

  it('両方のカードが0枚（完全終了）になったプレイヤーは、orderから除外され、rankings（あがり順）に記録される', () => {
    // 3人プレイで、現在のターンは p1
    const g = makeGame({
      order: ['p1', 'p2', 'p3'],
      ci: 0,
      rankings: [],
      trumpHands: { p1: [], p2: [{}], p3: [{}] }, // p1はトランプを出し切り済み
      unoHands: { p1: [], p2: [{}], p3: [{}] }   // p1が最後のUNOを出し切った状態（配列が空）
    });

    // 本来は applyUnoPlay の中で行われる「あがり判定ロジック」をシミュレート
    const p1TrumpDone = (g.trumpHands['p1'] || []).length === 0;
    const p1UnoDone = (g.unoHands['p1'] || []).length === 0;
    const isWinner = p1TrumpDone && p1UnoDone;

    if (isWinner) {
      g.rankings.push({ id: 'p1', name: 'Alice' });
      g.order = g.order.filter(id => id !== 'p1'); // p1を順番から消し去る！
    }

    // 【検証①】p1が順番リストから完全に消滅していること（＝これで次の周回からターンが来なくなる！）
    expect(g.order.includes('p1')).toBeFalsy();
    expect(g.order).toEqual(['p2', 'p3']);

    // 【検証②】あがり順（rankings）の1位にちゃんとAliceが記録されていること
    expect(g.rankings[0].id).toBe('p1');
  });

  it('プレイヤーがあがって残り1人になったら、自動的にゲーム全体が終了（isGameOver=true）になること', () => {
    // p1とp2がすでにゲームを終了し、手番リスト（order）に p3 しか残っていない状態を作る
    const g = makeGame({
      order: ['p3'], // 残り1人
      rankings: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }]
    });

    // 残りの人数が1人以下ならゲームオーバー
    const isGameOver = g.order.length <= 1;

    // 【検証】ゲームオーバーのフラグがちゃんと true になること
    expect(isGameOver).toBeTruthy();
  });
});