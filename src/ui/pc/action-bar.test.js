// ========================================
// action-bar.ts 単体テスト（モード導出）
// ========================================
import { describe, it, expect } from 'vitest';
import { deriveBarState, shouldShowUnoDeclare } from './action-bar.js';

const PLAYERS = [
  { id: 'me', name: '自分' },
  { id: 'p2', name: 'たろう' },
];

const T5 = { s: '♠', v: '5', id: 't5' };
const T6 = { s: '♠', v: '6', id: 't6' };
const U_RED5 = { c: 'red', t: 'num', v: '5' };
const U_RED3 = { c: 'red', t: 'num', v: '3' };

function makeGame(overrides = {}) {
  return {
    order: ['me', 'p2'],
    ci: 0,
    dir: 1,
    phase: 'trump',
    rankings: [],
    hasParent: null,
    trumpHands: { me: [T5, T6], p2: [] },
    unoHands: { me: [U_RED5, U_RED3], p2: [] },
    trumpField: [],
    unoDiscardPile: [U_RED5],
    unoCurrentColor: 'red',
    unoPenaltyAccum: 0,
    unoSaid: {},
    ...overrides,
  };
}

const UI = (overrides = {}) => ({
  selectedTrumpIds: [],
  selectedUnoIdx: null,
  pendingUnoIdx: null,
  override: null,
  ...overrides,
});

describe('deriveBarState — 基本モード', () => {
  it('他プレイヤーの手番なら waiting（手番プレイヤー名付き）', () => {
    const g = makeGame({ ci: 1 });
    const bar = deriveBarState(g, 'me', UI(), PLAYERS);
    expect(bar.mode).toBe('waiting');
    expect(bar.curName).toBe('たろう');
  });

  it('上がり済みなら spectator', () => {
    const g = makeGame({ rankings: [{ id: 'me', name: '自分' }] });
    expect(deriveBarState(g, 'me', UI(), PLAYERS).mode).toBe('spectator');
  });

  it('自分のトランプ手番なら trump', () => {
    expect(deriveBarState(makeGame(), 'me', UI(), PLAYERS).mode).toBe('trump');
  });

  it('トランプ手札0枚なら trump-skip', () => {
    const g = makeGame({ trumpHands: { me: [], p2: [] } });
    expect(deriveBarState(g, 'me', UI(), PLAYERS).mode).toBe('trump-skip');
  });

  it('自分のUNO手番なら uno、手札0枚なら uno-skip', () => {
    expect(deriveBarState(makeGame({ phase: 'uno' }), 'me', UI(), PLAYERS).mode).toBe('uno');
    const g = makeGame({ phase: 'uno', unoHands: { me: [], p2: [] } });
    expect(deriveBarState(g, 'me', UI(), PLAYERS).mode).toBe('uno-skip');
  });
});

describe('deriveBarState — 出すボタンの活性', () => {
  it('トランプ: 場が空で1枚選択していれば canSubmit=true', () => {
    const bar = deriveBarState(makeGame(), 'me', UI({ selectedTrumpIds: ['t5'] }), PLAYERS);
    expect(bar.canSubmit).toBe(true);
  });

  it('トランプ: 未選択なら canSubmit=false', () => {
    expect(deriveBarState(makeGame(), 'me', UI(), PLAYERS).canSubmit).toBe(false);
  });

  it('UNO: カード選択中のみ canSubmit=true', () => {
    const g = makeGame({ phase: 'uno' });
    expect(deriveBarState(g, 'me', UI({ selectedUnoIdx: 0 }), PLAYERS).canSubmit).toBe(true);
    expect(deriveBarState(g, 'me', UI(), PLAYERS).canSubmit).toBe(false);
  });
});

describe('deriveBarState — 一時モード（色選択）', () => {
  it('wild-color override はUNOフェイズ＋pending がある場合だけ有効', () => {
    const g = makeGame({ phase: 'uno' });
    const bar = deriveBarState(g, 'me', UI({ override: 'wild-color', pendingUnoIdx: 0 }), PLAYERS);
    expect(bar.mode).toBe('wild-color');
  });

  it('wild-color override は前提が崩れていたら無視される（手番が移った等）', () => {
    const g = makeGame({ phase: 'uno', ci: 1 });
    const bar = deriveBarState(g, 'me', UI({ override: 'wild-color', pendingUnoIdx: 0 }), PLAYERS);
    expect(bar.mode).toBe('waiting');
  });

  it('parent-color override は親のUNO手番だけ有効', () => {
    const g = makeGame({ phase: 'uno', hasParent: 'me' });
    expect(deriveBarState(g, 'me', UI({ override: 'parent-color' }), PLAYERS).mode).toBe('parent-color');
    const g2 = makeGame({ phase: 'uno', hasParent: 'p2' });
    expect(deriveBarState(g2, 'me', UI({ override: 'parent-color' }), PLAYERS).mode).toBe('uno');
  });
});

describe('deriveBarState — 親の権限ボタン', () => {
  it('自分が親のUNO手番なら showParentButton=true（手札0でも）', () => {
    const g = makeGame({ phase: 'uno', hasParent: 'me' });
    expect(deriveBarState(g, 'me', UI(), PLAYERS).showParentButton).toBe(true);
    const g2 = makeGame({ phase: 'uno', hasParent: 'me', unoHands: { me: [], p2: [] } });
    expect(deriveBarState(g2, 'me', UI(), PLAYERS).showParentButton).toBe(true);
  });

  it('トランプフェイズ中は親でも表示しない', () => {
    const g = makeGame({ hasParent: 'me' });
    expect(deriveBarState(g, 'me', UI(), PLAYERS).showParentButton).toBe(false);
  });
});

describe('shouldShowUnoDeclare — UNO宣言ウィンドウ', () => {
  it('残り2枚＋選択中＋未宣言のときだけ true', () => {
    expect(shouldShowUnoDeclare(2, 0, false)).toBe(true);
  });

  it('未選択なら false（出せない状態で宣言はできない）', () => {
    expect(shouldShowUnoDeclare(2, null, false)).toBe(false);
  });

  it('3枚以上・1枚では false', () => {
    expect(shouldShowUnoDeclare(3, 0, false)).toBe(false);
    expect(shouldShowUnoDeclare(1, 0, false)).toBe(false);
  });

  it('宣言済みなら false', () => {
    expect(shouldShowUnoDeclare(2, 0, true)).toBe(false);
  });
});
