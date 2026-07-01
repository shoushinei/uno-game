// ========================================
// ui-input.test.js
//
// ★重要★ ui-input.js はブラウザのグローバル `window` / `document` を
// （import せずに）直接参照する作りになっている。このプロジェクトの
// vitest 実行環境は jsdom ではなく素の Node 環境（`environment: 'node'`）
// のため、何も準備せずに `import './ui-input.js'` すると、モジュール読み込み
// 時点で実行される `Object.defineProperty(window, ...)` の行で
// `ReferenceError: window is not defined` になる。
//
// そこで、このテストファイルでは
//   1. `window` / `document` の最小限のスタブをグローバルに用意してから
//   2. 動的 import（トップレベル await）で ui-input.js を「1回だけ」読み込む
// という構成にする。
//
// ※ 以前のバージョンでは各テストごとに `vi.resetModules()` + 動的 import で
// モジュールを毎回再読み込みしていたが、これは
// `Object.defineProperty(window, '_selectedTrumpIds', ...)` を複数回実行し、
// （configurable:true を付けていても）テスト設計として不必要に壊れやすいため、
// 「モジュールは1回だけ読み込み、状態は beforeEach でリセットする」方式に
// 変更している。
// ========================================
import { describe, it, expect, beforeEach } from 'vitest';

// ui-input.js のトップレベルで参照される前に window/document を用意する
globalThis.window = globalThis.window ?? {};
globalThis.document = globalThis.document ?? {
  getElementById: () => null,
  querySelectorAll: () => [],
};

const {
  setPendingUnoIdx,
  getPendingUnoIdx,
  clearPendingUnoIdx,
  resetTrumpSelection,
  resetUnoSelection,
  getSelectedTrumpIds,
  getSelectedUnoIdx,
  isTrumpCardVisiblySelected,
  isUnoCardVisiblySelected,
} = await import('./ui-input.js');

beforeEach(() => {
  // 各テストの前に、モジュールスコープの可変状態を必ずクリーンな状態へ戻す。
  resetTrumpSelection();
  resetUnoSelection();
  clearPendingUnoIdx();
  // window.selectTrumpCard / selectUnoCard が参照する補助データもリセットする
  window._currentTrumpHand = [];
  window._currentGame = { trumpField: [] };
});

describe('バグ2: ワイルドカード送信時に pendingUnoIdx が消えてしまう', () => {
  it('resetUnoSelection() を呼んでも pendingUnoIdx は保持される', () => {
    setPendingUnoIdx(4);
    resetUnoSelection();
    expect(getPendingUnoIdx()).toBe(4);
  });

  it('resetUnoSelection() は見た目の選択（selectedUnoIdx）はちゃんとクリアする', () => {
    window.selectUnoCard(2);
    expect(getSelectedUnoIdx()).toBe(2);
    resetUnoSelection();
    expect(getSelectedUnoIdx()).toBeNull();
  });

  it('clearPendingUnoIdx() で明示的に pendingUnoIdx をクリアできる', () => {
    setPendingUnoIdx(5);
    clearPendingUnoIdx();
    expect(getPendingUnoIdx()).toBeNull();
  });

  it('ワイルドカードの実際のフローを再現しても idx を失わない：選択→送信保留→リセット→色決定', () => {
    // 1. ユーザーが手札のワイルドカード(idx=3)をクリックして選択
    window.selectUnoCard(3);
    // 2. 「出す」ボタン押下：app.js はワイルドだと判断し、色決定待ちとして idx を保持してから
    //    見た目の選択状態だけをリセットし、色ピッカーを表示する
    setPendingUnoIdx(3);
    resetUnoSelection();
    // 3. 色ピッカーで色を選んだ瞬間、pendingUnoIdx はまだ 3 のままでなければならない
    //    （actionUnoPlay(getPendingUnoIdx(), color) が null ではなく 3 を渡せること）
    expect(getPendingUnoIdx()).toBe(3);
  });
});

describe('バグ1: 選択状態の残留を防ぐ純粋ヘルパー（isUnoCardVisiblySelected / isTrumpCardVisiblySelected）', () => {
  it('UNO: 自分のターンでない時は、古い selectedIdx が残っていても選択済み扱いにしない', () => {
    // 直前のターンで idx=2 のカードを出した後、選択状態がリセットされずに
    // 残ってしまったケースを想定（＝バグ報告の「右隣のカードが選択済みになる」現象の原因）
    expect(isUnoCardVisiblySelected(2, 2, false)).toBe(false);
  });

  it('UNO: 自分のターンで、実際に選んだカードは選択済みとして表示される', () => {
    expect(isUnoCardVisiblySelected(1, 1, true)).toBe(true);
  });

  it('UNO: selectedIdx が null/undefined ならどのカードも選択済みにならない', () => {
    expect(isUnoCardVisiblySelected(0, null, true)).toBe(false);
    expect(isUnoCardVisiblySelected(0, undefined, true)).toBe(false);
  });

  it('トランプ: 自分のターンでない時は選択済み扱いにしない', () => {
    expect(isTrumpCardVisiblySelected('c1', ['c1'], false)).toBe(false);
  });

  it('トランプ: 自分のターンで選択リストに含まれていれば選択済み', () => {
    expect(isTrumpCardVisiblySelected('c1', ['c1', 'c2'], true)).toBe(true);
    expect(isTrumpCardVisiblySelected('c3', ['c1', 'c2'], true)).toBe(false);
  });
});

describe('resetTrumpSelection / resetUnoSelection', () => {
  it('resetTrumpSelection() は選択中のトランプカードIDを全て消す', () => {
    // 場が空の状態なら、どのカードも選択可能（trumpCanPlayCard が true を返す）
    window._currentTrumpHand = [{ s: '♠', v: '5', id: 'c1' }];
    window._currentGame = { trumpField: [] };
    window.selectTrumpCard('c1');
    expect(getSelectedTrumpIds()).toEqual(['c1']);

    resetTrumpSelection();
    expect(getSelectedTrumpIds()).toEqual([]);
  });

  it('resetUnoSelection() は選択中のUNOカードindexを消す', () => {
    window.selectUnoCard(0);
    expect(getSelectedUnoIdx()).toBe(0);

    resetUnoSelection();
    expect(getSelectedUnoIdx()).toBeNull();
  });
});