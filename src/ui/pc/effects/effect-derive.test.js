// ========================================
// effect-derive.ts / effect-queue.ts 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import {
  deriveFromEntries,
  deriveFromDiff,
  deriveTrumpSpecial,
  nextTrumpSpecial,
  takeSnapshot,
  MASS_SKIP_THRESHOLD,
} from './effect-derive.js';
import { trimQueue, QUEUE_MAX } from './effect-queue.js';

const e = (type, playerId, args = {}) => ({ type, playerId, args, ts: 1 });

const PLAYERS = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' },
];

function makeGame(overrides = {}) {
  return {
    order: ['p1', 'p2', 'p3'],
    ci: 0,
    dir: 1,
    phase: 'trump',
    rankings: [],
    hasParent: null,
    trumpField: [],
    ...overrides,
  };
}

// ----------------------------------------
// A. actionLog増分からの導出
// ----------------------------------------
describe('deriveFromEntries', () => {
  it('trumpPlay はカードIDを復元して trump-play になる', () => {
    const [d] = deriveFromEntries([e('trumpPlay', 'p1', { cardIds: ['♠5', '♥5'] })]);
    expect(d.kind).toBe('trump-play');
    expect(d.cards.length).toBe(2);
    expect(d.cards[0]).toEqual({ s: '♠', v: '5', id: '♠5' });
  });

  it('unoPlay / unoDraw / trumpPass / sayUno / pickParentColor をそれぞれ導出する', () => {
    const descs = deriveFromEntries([
      e('unoPlay', 'p1', { cardIdx: 0, chosenColor: null, card: { c: 'red', t: 'num', v: '5' } }),
      e('unoDraw', 'p2', { count: 4 }),
      e('trumpPass', 'p3'),
      e('sayUno', 'p1'),
      e('pickParentColor', 'p2', { color: 'blue' }),
    ]);
    expect(descs.map(d => d.kind)).toEqual(['uno-play', 'draw', 'pass', 'say-uno', 'parent-color']);
    expect(descs[1].count).toBe(4);
    expect(descs[4].color).toBe('blue');
  });

  it('trumpSkip / unoSkip は演出を出さない（bot対戦でうるさくなるため）', () => {
    expect(deriveFromEntries([e('trumpSkip', 'p1'), e('unoSkip', 'p1')])).toEqual([]);
  });

  it('増分が閾値を超えたら（再接続の追いつき等）全部スキップする', () => {
    const many = Array.from({ length: MASS_SKIP_THRESHOLD + 1 }, () => e('trumpPass', 'p1'));
    expect(deriveFromEntries(many)).toEqual([]);
  });
});

// ----------------------------------------
// B. 状態diffからの導出
// ----------------------------------------
describe('deriveFromDiff', () => {
  it('初回同期＋actionLogが空 → ゲーム開始演出（先手名付き）', () => {
    const g = makeGame({ ci: 1 });
    const snap = takeSnapshot(g, { actionLog: [] });
    const descs = deriveFromDiff(null, snap, g, PLAYERS);
    expect(descs.length).toBe(1);
    expect(descs[0].kind).toBe('game-start');
    expect(descs[0].firstPlayerName).toBe('B');
  });

  it('初回同期でもactionLogが進んでいれば（リロード・途中参加）開始演出は出ない', () => {
    const g = makeGame();
    const snap = takeSnapshot(g, { actionLog: [e('trumpPass', 'p1')] });
    expect(deriveFromDiff(null, snap, g, PLAYERS)).toEqual([]);
  });

  it('トランプの場が「あり→空」になったら field-clear（新しい親付き）', () => {
    const g1 = makeGame({ trumpField: [{ s: '♠', v: '8', id: '♠8' }] });
    const g2 = makeGame({ trumpField: [], hasParent: 'p2' });
    const prev = takeSnapshot(g1, { actionLog: [] });
    const next = takeSnapshot(g2, { actionLog: [] });
    const descs = deriveFromDiff(prev, next, g2, PLAYERS);
    expect(descs).toEqual([{ kind: 'field-clear', parentId: 'p2' }]);
  });

  it('dir が変わったら reverse', () => {
    const prev = takeSnapshot(makeGame({ dir: 1 }), { actionLog: [] });
    const next = takeSnapshot(makeGame({ dir: -1 }), { actionLog: [] });
    const descs = deriveFromDiff(prev, next, makeGame({ dir: -1 }), PLAYERS);
    expect(descs).toEqual([{ kind: 'reverse', dir: -1 }]);
  });

  it('rankings が増えたら finish（順位付き・複数同時にも対応）', () => {
    const prev = takeSnapshot(makeGame({ rankings: [{ id: 'p1' }] }), { actionLog: [] });
    const g2 = makeGame({ rankings: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] });
    const next = takeSnapshot(g2, { actionLog: [] });
    const descs = deriveFromDiff(prev, next, g2, PLAYERS);
    expect(descs).toEqual([
      { kind: 'finish', playerId: 'p2', rank: 2 },
      { kind: 'finish', playerId: 'p3', rank: 3 },
    ]);
  });

  it('変化がなければ何も出さない', () => {
    const g = makeGame();
    const snap = takeSnapshot(g, { actionLog: [] });
    expect(deriveFromDiff(snap, takeSnapshot(g, { actionLog: [] }), g, PLAYERS)).toEqual([]);
  });
});

// ----------------------------------------
// C. trumpEffect からの導出
// ----------------------------------------
describe('deriveTrumpSpecial', () => {
  it('types をそのまま持つ trump-special を返す', () => {
    const d = deriveTrumpSpecial({ types: ['eightCut'], playerId: 'p1', ts: 9 }, false);
    expect(d).toEqual({ kind: 'trump-special', types: ['eightCut'], playerId: 'p1', revolutionOn: false });
  });

  it('types が無く type だけの古い形式にも対応する', () => {
    const d = deriveTrumpSpecial({ type: 'revolution', playerId: 'p1', ts: 9 }, true);
    expect(d.types).toEqual(['revolution']);
    expect(d.revolutionOn).toBe(true);
  });

  it('種別が空なら null', () => {
    expect(deriveTrumpSpecial({ types: [], playerId: 'p1' }, false)).toBeNull();
    expect(deriveTrumpSpecial(null, false)).toBeNull();
  });
});

// ----------------------------------------
// C-2. 既読tsの進行（PC UIの演出＋音／モバイルUIの音・触覚で共有）
// ----------------------------------------
describe('nextTrumpSpecial', () => {
  const te = (ts, types = ['eightCut']) => ({ types, playerId: 'p1', ts });

  it('初回同期(null)は既読tsを記録するだけで何も返さない', () => {
    // リロード直後に、開く前に起きていた特殊効果を鳴らさないため
    expect(nextTrumpSpecial(null, te(100), false)).toEqual({ seenTs: 100, desc: null });
  });

  it('★trumpEffect がまだ無い初回も 0 で初期化する★', () => {
    // null のままだと、最初に起きた特殊効果が「初回扱い」でスキップされる
    const first = nextTrumpSpecial(null, undefined, false);
    expect(first).toEqual({ seenTs: 0, desc: null });
    const then = nextTrumpSpecial(first.seenTs, te(100), false);
    expect(then.seenTs).toBe(100);
    expect(then.desc).toMatchObject({ kind: 'trump-special', types: ['eightCut'] });
  });

  it('ts が変わったときだけ返す（同じ ts で再描画されても二度鳴らない）', () => {
    const a = nextTrumpSpecial(0, te(100), false);
    expect(a.desc).not.toBeNull();
    const b = nextTrumpSpecial(a.seenTs, te(100), false);
    expect(b).toEqual({ seenTs: 100, desc: null });
    const c = nextTrumpSpecial(b.seenTs, te(200, ['revolution']), true);
    expect(c.seenTs).toBe(200);
    expect(c.desc).toMatchObject({ types: ['revolution'], revolutionOn: true });
  });

  it('trumpEffect が消えても既読tsは巻き戻さない', () => {
    // 場が流れて trumpEffect が消えたときに、既読を0へ戻すと
    // 同じ ts の効果がもう一度鳴ってしまう
    expect(nextTrumpSpecial(100, null, false)).toEqual({ seenTs: 100, desc: null });
  });
});

// ----------------------------------------
// キューの間引き
// ----------------------------------------
describe('trimQueue', () => {
  it('上限以内はそのまま', () => {
    expect(trimQueue([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('上限を超えたら新しい方を残す', () => {
    const q = [1, 2, 3, 4, 5, 6];
    expect(trimQueue(q, 4)).toEqual([3, 4, 5, 6]);
  });

  it('QUEUE_MAX がデフォルト上限', () => {
    const q = Array.from({ length: QUEUE_MAX + 3 }, (_, i) => i);
    expect(trimQueue(q).length).toBe(QUEUE_MAX);
  });
});
