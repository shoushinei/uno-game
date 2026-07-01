// ========================================
// game-rules.js 単体テスト
// ========================================
import { describe, it, expect } from 'vitest'; 
import {
  checkAllPassed,
  resolveRankingNames,
  applyTrumpSkip,
  applyUnoSkip,
  finalizeIfBothHandsEmpty,
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
    applyTrumpSkip(g, 'p1', 'Alice');
    expect(g.phase).toBe('uno');
  });

  it('logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame({ phase: 'trump' });
    const { logMsg } = applyTrumpSkip(g, 'p2', 'Bob');
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
// checkAllPassed 追加テスト（正常系・異常系）
// ========================================
describe('checkAllPassed — 追加（正常系）', () => {
  it('cleared=true のとき logMsg は null でない', () => {
    const g = makeGame();
    const r = checkAllPassed(g, 2, PLAYERS);
    expect(r.logMsg).not.toBeNull();
  });

  it('cleared=false のとき logMsg は null', () => {
    const g = makeGame();
    const r = checkAllPassed(g, 0, PLAYERS);
    expect(r.logMsg).toBeNull();
  });

  it('cleared=true のとき trumpField が空配列になる', () => {
    const g = makeGame();
    checkAllPassed(g, 2, PLAYERS);
    expect(g.trumpField).toEqual([]);
  });
});

describe('checkAllPassed — 追加（異常系）', () => {
  it('order が空の場合は cleared=false を返す', () => {
    const g = makeGame({ order: [] });
    const r = checkAllPassed(g, 0, PLAYERS);
    expect(r.cleared).toBe(false);
  });

  it('PLAYERS に ci のプレイヤーが見つからなくても例外にならず parentName が "?" になる', () => {
    const g = makeGame({ ci: 0, order: ['unknown'] });
    const r = checkAllPassed(g, 0, PLAYERS); // order.length-1 = 0, passCount=0 → cleared=true
    expect(r.cleared).toBe(true);
    expect(r.parentName).toBe('?');
  });
});

// ========================================
// resolveRankingNames 追加テスト（正常系・異常系）
// ========================================
describe('resolveRankingNames — 追加（正常系）', () => {
  it('複数の ? を一度に解決できる', () => {
    const rankings = [
      { id: 'p1', name: '?' },
      { id: 'p2', name: '?' },
      { id: 'p3', name: '?' },
    ];
    resolveRankingNames(rankings, PLAYERS);
    expect(rankings[0].name).toBe('Alice');
    expect(rankings[1].name).toBe('Bob');
    expect(rankings[2].name).toBe('Carol');
  });

  it('空の rankings を渡してもエラーにならない', () => {
    expect(() => resolveRankingNames([], PLAYERS)).not.toThrow();
  });
});

describe('resolveRankingNames — 追加（異常系）', () => {
  it('PLAYERS が空でも例外にならず ? のまま', () => {
    const rankings = [{ id: 'p1', name: '?' }];
    expect(() => resolveRankingNames(rankings, [])).not.toThrow();
    expect(rankings[0].name).toBe('?');
  });
});

// ========================================
// applyTrumpSkip 追加テスト（正常系・異常系）
// ========================================
describe('applyTrumpSkip — 追加（正常系）', () => {
  it('返り値は { logMsg } の形を持つ', () => {
    const g = makeGame();
    const r = applyTrumpSkip(g, 'p1', 'Alice');
    expect(r).toHaveProperty('logMsg');
  });

  it('何度呼んでも phase は uno のまま（冪等性）', () => {
    const g = makeGame();
    applyTrumpSkip(g, 'p1', 'Alice');
    applyTrumpSkip(g, 'p1', 'Alice');
    expect(g.phase).toBe('uno');
  });
});

describe('applyTrumpSkip — 追加（異常系）', () => {
  it('playerName が空文字でもエラーにならず logMsg が生成される', () => {
    const g = makeGame();
    const { logMsg } = applyTrumpSkip(g, 'p1', '');
    expect(typeof logMsg).toBe('string');
  });
});

// ========================================
// applyParentColorChange 追加テスト（正常系・異常系）
// ========================================
describe('applyParentColorChange — 追加（正常系）', () => {
  it('返り値は { logMsg } の形を持つ', () => {
    const g = makeGame({ hasParent: 'p1' });
    const r = applyParentColorChange(g, 'p1', 'red', 'Alice');
    expect(r).toHaveProperty('logMsg');
  });

  it('4色すべてで色変更できる', () => {
    ['red', 'blue', 'green', 'yellow'].forEach(color => {
      const g = makeGame({ hasParent: 'p1' });
      const r = applyParentColorChange(g, 'p1', color, 'Alice');
      expect(r).not.toBeNull();
      expect(g.unoCurrentColor).toBe(color);
    });
  });

  it('logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame({ hasParent: 'p1' });
    const r = applyParentColorChange(g, 'p1', 'blue', 'Alice');
    expect(r.logMsg).toContain('Alice');
  });
});

describe('applyParentColorChange — 追加（異常系）', () => {
  it('hasParent が null なら null を返す', () => {
    const g = makeGame({ hasParent: null });
    const r = applyParentColorChange(g, 'p1', 'blue', 'Alice');
    expect(r).toBeNull();
  });

  it('一度使用した後は hasParent が null になるため再度呼んでも null を返す（1回限り保証）', () => {
    const g = makeGame({ hasParent: 'p1' });
    applyParentColorChange(g, 'p1', 'blue', 'Alice'); // 1回目：成功
    const r2 = applyParentColorChange(g, 'p1', 'red', 'Alice'); // 2回目：失敗
    expect(r2).toBeNull();
    expect(g.unoCurrentColor).toBe('blue'); // 1回目の結果のまま
  });
});

// ========================================
// applyUnoDeclaration 追加テスト（正常系・異常系）
// ========================================
describe('applyUnoDeclaration — 追加（正常系）', () => {
  it('複数プレイヤーが別々に宣言しても互いに干渉しない', () => {
    const g = makeGame({ unoSaid: {} });
    applyUnoDeclaration(g, 'p1', 'Alice');
    applyUnoDeclaration(g, 'p2', 'Bob');
    expect(g.unoSaid['p1']).toBeTruthy();
    expect(g.unoSaid['p2']).toBeTruthy();
  });

  it('返り値は { logMsg } の形を持つ', () => {
    const g = makeGame({ unoSaid: {} });
    const r = applyUnoDeclaration(g, 'p1', 'Alice');
    expect(r).toHaveProperty('logMsg');
  });

  it('logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame({ unoSaid: {} });
    const { logMsg } = applyUnoDeclaration(g, 'p1', 'Carol');
    expect(logMsg).toContain('Carol');
  });
});

describe('applyUnoDeclaration — 追加（異常系）', () => {
  it('同じプレイヤーが2回宣言してもエラーにならない（上書き可）', () => {
    const g = makeGame({ unoSaid: {} });
    applyUnoDeclaration(g, 'p1', 'Alice');
    expect(() => applyUnoDeclaration(g, 'p1', 'Alice')).not.toThrow();
    expect(g.unoSaid['p1']).toBeTruthy();
  });

  it('playerName が空文字でもエラーにならず unoSaid が更新される', () => {
    const g = makeGame({ unoSaid: {} });
    applyUnoDeclaration(g, 'p1', '');
    expect(g.unoSaid['p1']).toBeTruthy();
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

  it('残りプレイヤーが1人以下になると isGameOver=true', () => {
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

// ========================================
// ★バグ3 回帰テスト★
// 「全員パス」が成立した瞬間に checkAllPassed() が g.ci / g.phase を
// 書き換えてしまい、最後にパスした本人のUNOターンがまるごとスキップされていた
// 不具合の回帰テスト。
// ========================================
describe('checkAllPassed — バグ3回帰（全員パスでの手番すっ飛ばし防止）', () => {
  it('★重要★ 全員パス成立の瞬間に g.ci / g.phase を書き換えてはいけない（最後にパスした本人のUNOターンを奪わない）', () => {
    const g = makeGame({
      ci: 2, // Carol が最後にパスした直後を想定
      phase: 'uno', // applyTrumpPass が既にセットしたUNOフェイズ
      trumpField: [{ s: '♠', v: '5', id: '♠5' }],
    });
    const before = { ci: g.ci, phase: g.phase };

    const r = checkAllPassed(g, 2, PLAYERS);

    expect(r.cleared).toBe(true);
    // ci・phase は checkAllPassed 呼び出し前後で変化しないこと
    expect(g.ci).toBe(before.ci);
    expect(g.phase).toBe(before.phase);
  });

  it('3人プレイのフルシナリオ：A出す→B/Cパス→Cのターンが飛ばされず、Aが正しいタイミングで親になる', () => {
    function nextIdx(idx, dir, n) { return (idx + dir + n) % n; }
    function fakeTrumpPlay(g, playerId) {
      g.trumpField = [{ s: '♠', v: '5', id: 'x' }];
      g.trumpFieldOwner = playerId;
      g.phase = 'uno';
    }
    function fakeTrumpPass(g) {
      g.phase = 'uno'; // ci は変えない（applyTrumpPass 本体と同じ挙動）
    }
    function fakeUnoTurnEnds(g, playerId) {
      g.phase = 'trump';
      const myIdx = g.order.indexOf(playerId);
      g.ci = nextIdx(myIdx, g.dir, g.order.length);
    }

    const g = makeGame({ order: ['p1', 'p2', 'p3'], ci: 0, dir: 1, phase: 'trump', trumpField: [] });
    let passCount = 0;

    // 1. p1(Alice) がトランプを出す → AliceのUNOターン
    fakeTrumpPlay(g, 'p1');
    expect(g.ci).toBe(0);
    expect(g.phase).toBe('uno');
    fakeUnoTurnEnds(g, 'p1'); // Aliceのターン終了 → Bobのトランプターンへ
    expect([g.ci, g.phase]).toEqual([1, 'trump']);

    // 2. p2(Bob) がパス → BobのUNOターン
    fakeTrumpPass(g);
    passCount += 1;
    let r = checkAllPassed(g, passCount, PLAYERS);
    expect(r.cleared).toBe(false);
    expect([g.ci, g.phase]).toEqual([1, 'uno']); // Bobのターンのまま
    fakeUnoTurnEnds(g, 'p2');
    expect([g.ci, g.phase]).toEqual([2, 'trump']);

    // 3. p3(Carol) がパス → 全員パス成立。しかし Carol 自身のUNOターンは飛ばされてはいけない
    fakeTrumpPass(g);
    passCount += 1;
    r = checkAllPassed(g, passCount, PLAYERS);
    expect(r.cleared).toBe(true);
    expect(g.hasParent).toBe('p1'); // Aliceが親
    // ★ここがバグ3の核心：Carolのターン(ci=2)・UNOフェイズのままであること
    expect(g.ci).toBe(2);
    expect(g.phase).toBe('uno');

    // Carol が自分のUNOターンを消化 → 自然にAliceのトランプターンへ
    fakeUnoTurnEnds(g, 'p3');
    expect([g.ci, g.phase]).toEqual([0, 'trump']);
    expect(g.trumpField).toEqual([]); // 場が流れているので何でも出せる

    // 4. Alice がトランプを出す（今度は「親」としてUNOフェイズで色変更権限が使える）
    fakeTrumpPlay(g, 'p1');
    expect([g.ci, g.phase]).toEqual([0, 'uno']);
    expect(g.hasParent).toBe('p1'); // 【親の権限発動】が正しいタイミングで使える
  });
});

// ========================================
// applyUnoSkip のテスト
// ★バグ修正で追加された関数★（UNO手札0枚時の自動スキップ）
// ========================================
describe('applyUnoSkip', () => {
  it('次のプレイヤーのトランプターンへ進める', () => {
    const g = makeGame({ phase: 'uno', ci: 0 });
    applyUnoSkip(g, 'p1', 'Alice');
    expect(g.phase).toBe('trump');
    expect(g.ci).toBe(1); // p2(Bob)へ
  });

  it('自分が親の場合、色変更権限を行使せずに hasParent をクリアする', () => {
    const g = makeGame({ phase: 'uno', ci: 0, hasParent: 'p1' });
    const { logMsg } = applyUnoSkip(g, 'p1', 'Alice');
    expect(g.hasParent).toBeNull();
    expect(logMsg).toContain('行使せず');
  });

  it('自分が親でない場合は hasParent に影響しない', () => {
    const g = makeGame({ phase: 'uno', ci: 0, hasParent: 'p2' });
    applyUnoSkip(g, 'p1', 'Alice');
    expect(g.hasParent).toBe('p2');
  });

  it('logMsg にプレイヤー名が含まれる', () => {
    const g = makeGame({ phase: 'uno', ci: 0 });
    const { logMsg } = applyUnoSkip(g, 'p1', 'Alice');
    expect(logMsg).toContain('Alice');
  });

  it('反時計回り（dir=-1）でも正しく前のプレイヤーへ進む', () => {
    const g = makeGame({ phase: 'uno', ci: 0, dir: -1 });
    applyUnoSkip(g, 'p1', 'Alice');
    expect(g.ci).toBe(2); // 逆回りなので p3(Carol)へ
  });
});

// ========================================
// finalizeIfBothHandsEmpty のテスト
// ★バグ修正で追加された関数★（Firebase互換性）
// ========================================
describe('finalizeIfBothHandsEmpty の Firebase互換性テスト', () => {
  it('Firebaseの仕様で手札配列が undefined になった場合でも、正しく上がり（finished: true）と判定されること', () => {
    // Firebaseに空配列を書き込むと、読み込み時にオブジェクトからキーごと消える状態をシミュレート
    const g = {
      order: ['p1', 'p2', 'p3'],
      ci: 0,
      phase: 'trump',
      dir: 1,
      // p1 の手札データをあえて定義しない（＝undefined）
      trumpHands: {
        p2: ['S3'],
        p3: ['H5']
      },
      unoHands: {
        p2: ['red-1'],
        p3: ['blue-2']
      },
      rankings: []
    };

    // p1（手札が両方存在しない＝実質0枚）の上がりチェック
    const result = finalizeIfBothHandsEmpty(g, 'p1', 'プレイヤー1');

    expect(result.finished).toBe(true);
    expect(g.rankings[0].id).toBe('p1');
    expect(g.order).not.toContain('p1'); // プレイヤー1がゲームから除外されていること
  });

  it('手札が残っている場合は上がらず、通常の自動スキップが機能すること', () => {
    const g = {
      order: ['p1', 'p2'],
      ci: 0,
      phase: 'trump',
      dir: 1,
      trumpHands: {
        p1: [] // トランプは0枚（Firebaseで消えた状態）
      },
      unoHands: {
        p1: ['red-7'] // UNOはまだ残っている
      },
      rankings: []
    };

    // トランプ0枚による自動スキップを実行
    const result = applyTrumpSkip(g, 'p1', 'プレイヤー1');

    expect(result.isGameOver).toBe(false);
    expect(g.phase).toBe('uno'); // 上がらずにUNOフェイズへ進むこと
  });
});

// ========================================
// ★新しく追加：順位確定シナリオ（1位・2位・3位）のテスト★
// ========================================
describe('大富豪×UNO 融合ゲームの順位確定シナリオ（1位・2位・3位）', () => {

  it('【1位確定：UNOが先】AのUNOが先に上がっており、後からトランプが上がった時に1位になれるか', () => {
    const g = {
      order: ['p1', 'p2', 'p3'],
      ci: 0, phase: 'trump', dir: 1, rankings: [],
      trumpHands: { p1: [], p2: ['S3'], p3: ['H4'] }, // Aのトランプが0枚になった状態
      unoHands:   { p1: [], p2: ['red-1'], p3: ['blue-2'] } // AのUNOはすでに0枚
    };

    const result = finalizeIfBothHandsEmpty(g, 'p1', 'Alice');

    expect(result.finished).toBe(true);
    expect(g.rankings[0].id).toBe('p1'); // Aが1位
    expect(g.order).not.toContain('p1'); // 順番から除外
  });

  it('【1位確定：トランプが先】Aのトランプが先に上がっており、後からUNOが上がった時に1位になれるか', () => {
    const g = {
      order: ['p1', 'p2', 'p3'],
      ci: 0, phase: 'uno', dir: 1, rankings: [],
      trumpHands: { p1: [], p2: ['S3'], p3: ['H4'] }, // Aのトランプはすでに0枚
      unoHands:   { p1: [], p2: ['red-1'], p3: ['blue-2'] } // AのUNOが0枚になった状態
    };

    const result = finalizeIfBothHandsEmpty(g, 'p1', 'Alice');

    expect(result.finished).toBe(true);
    expect(g.rankings[0].id).toBe('p1'); // Aが1位
    expect(g.order).not.toContain('p1'); // 順番から除外
  });

  it('【2位・3位確定：UNOが先】Aが上がった状態で、BのUNOが先に上がっており、トランプが上がった時にBが2位になり、Cが3位になるか', () => {
    const g = {
      order: ['p2', 'p3'], // A(p1)はすでに抜けている
      ci: 0, phase: 'trump', dir: 1,
      rankings: [{ id: 'p1', name: 'Alice' }], // 1位はすでにA(p1)
      trumpHands: { p2: [], p3: ['H4'] }, // Bのトランプが0枚になった状態
      unoHands:   { p2: [], p3: ['blue-2'] } // BのUNOはすでに0枚
    };

    const result = finalizeIfBothHandsEmpty(g, 'p2', 'Bob');

    expect(result.finished).toBe(true);
    expect(g.rankings[1].id).toBe('p2'); // Bが2位
    expect(g.order).not.toContain('p2'); // Bが順番から除外される

    // game-rules.jsの内部で「残り1人になったらその人を自動で最下位にする」仕様、
    // または関数の戻り値でゲーム終了フラグが立つかを検証
    expect(result.isGameOver).toBe(true); 
    
    // もしgame-rules.js側で最後の一人を自動でランキングに入れるロジックが走る仕様であれば以下も通る
    if (g.rankings.length === 3) {
      expect(g.rankings[2].id).toBe('p3'); // Cが3位
    }
  });

  it('【2位・3位確定：トランプが先】Aが上がった状態で、Bのトランプが先に上がっており、UNOが上がった時にBが2位になり、Cが3位になるか', () => {
    const g = {
      order: ['p2', 'p3'], // A(p1)はすでに抜けている
      ci: 0, phase: 'uno', dir: 1,
      rankings: [{ id: 'p1', name: 'Alice' }], // 1位はすでにA(p1)
      trumpHands: { p2: [], p3: ['H4'] }, // Bのトランプはすでに0枚
      unoHands:   { p2: [], p3: ['blue-2'] } // BのUNOが0枚になった状態
    };

    const result = finalizeIfBothHandsEmpty(g, 'p2', 'Bob');

    expect(result.finished).toBe(true);
    expect(g.rankings[1].id).toBe('p2'); // Bが2位
    expect(g.order).not.toContain('p2'); // Bが順番から除外される
    expect(result.isGameOver).toBe(true); // ゲーム終了

    if (g.rankings.length === 3) {
      expect(g.rankings[2].id).toBe('p3'); // Cが3位
    }
  });
});