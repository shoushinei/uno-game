// ========================================
// reaction-menu.ts 単体テスト
// （ブロックの localStorage 入出力とメニューHTML生成）
// ========================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SEAT_REACTION_EMOJIS,
  isReactorBlocked,
  toggleReactorBlock,
  renderReactionMenuHtml,
} from './reaction-menu.js';

// vitest の node 環境には localStorage が無いので最小限のモックを差し込む
beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
});

describe('toggleReactorBlock / isReactorBlocked — ブロックの永続化', () => {
  it('初期状態は誰もブロックしていない', () => {
    expect(isReactorBlocked('p1')).toBe(false);
  });

  it('トグルでブロック→解除できる', () => {
    expect(toggleReactorBlock('p1')).toBe(true);
    expect(isReactorBlocked('p1')).toBe(true);
    expect(toggleReactorBlock('p1')).toBe(false);
    expect(isReactorBlocked('p1')).toBe(false);
  });

  it('プレイヤーごとに独立して記憶する', () => {
    toggleReactorBlock('p1');
    toggleReactorBlock('p2');
    expect(isReactorBlocked('p1')).toBe(true);
    expect(isReactorBlocked('p2')).toBe(true);
    expect(isReactorBlocked('p3')).toBe(false);
  });

  it('同じIDを二重にブロックしても解除は1回で済む', () => {
    toggleReactorBlock('p1'); // block
    toggleReactorBlock('p1'); // unblock
    expect(isReactorBlocked('p1')).toBe(false);
  });

  it('壊れた localStorage 値でもクラッシュせず空とみなす', () => {
    globalThis.localStorage.setItem('pcgBlockedReactors', '{not json');
    expect(isReactorBlocked('p1')).toBe(false);
    expect(toggleReactorBlock('p1')).toBe(true);
    expect(isReactorBlocked('p1')).toBe(true);
  });
});

describe('renderReactionMenuHtml — メニューHTML生成', () => {
  it('全ての対人リアクション絵文字ボタンを宛先付きで出す', () => {
    const html = renderReactionMenuHtml('p1', 'たろう', false, false);
    for (const e of SEAT_REACTION_EMOJIS) {
      expect(html).toContain(`data-emoji="${e}"`);
    }
    expect(html).toContain('data-action="react-emoji"');
    expect(html).toContain('data-target="p1"');
    expect(html).toContain('たろう');
  });

  it('クールダウン中は絵文字ボタンを無効化して理由を添える', () => {
    const html = renderReactionMenuHtml('p1', 'たろう', false, true);
    expect(html).toContain('disabled');
    expect(html).toContain('pcg-rm-emoji off');
    expect(html).toContain('クールダウン中');
  });

  it('ブロック状態でボタンのラベルとクラスが切り替わる', () => {
    const off = renderReactionMenuHtml('p1', 'たろう', false, false);
    expect(off).toContain('data-action="react-block"');
    expect(off).not.toContain('pcg-rm-block on');

    const on = renderReactionMenuHtml('p1', 'たろう', true, false);
    expect(on).toContain('pcg-rm-block on');
    expect(on).toContain('解除');
  });
});
