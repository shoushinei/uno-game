// ========================================
// drawer.ts 単体テスト（ログのマージロジック）
// ========================================
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeServerLog, resetDrawerLog, renderDrawerHtml, toggleDrawer, isDrawerOpen } from './drawer.js';

beforeEach(() => {
  resetDrawerLog();
  // 開いた状態でログタブが描画されるようにする
  if (!isDrawerOpen()) toggleDrawer();
});

/** renderDrawerHtml からログ行だけを抜き出すヘルパー */
function logLines() {
  const html = renderDrawerHtml({});
  return [...html.matchAll(/pcg-log-line[^"]*">([^<]*)</g)].map(m => m[1]);
}

describe('mergeServerLog — サーバーの末尾8件窓を蓄積ログへマージ', () => {
  it('初回はそのまま取り込む', () => {
    mergeServerLog(['a', 'b', 'c']);
    expect(logLines()).toEqual(['a', 'b', 'c']);
  });

  it('重なり部分は二重に取り込まない', () => {
    mergeServerLog(['a', 'b', 'c']);
    mergeServerLog(['b', 'c', 'd', 'e']); // b,c は既にある
    expect(logLines()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('完全に同じ配列を再受信しても増えない（Firebase同期の重複呼び出し対策）', () => {
    mergeServerLog(['a', 'b']);
    mergeServerLog(['a', 'b']);
    expect(logLines()).toEqual(['a', 'b']);
  });

  it('窓が完全に入れ替わっていたら（8件以上進んだ）全件追記する', () => {
    mergeServerLog(['a', 'b']);
    mergeServerLog(['x', 'y', 'z']);
    expect(logLines()).toEqual(['a', 'b', 'x', 'y', 'z']);
  });

  it('空・null は無視する', () => {
    mergeServerLog(['a']);
    mergeServerLog([]);
    mergeServerLog(null);
    expect(logLines()).toEqual(['a']);
  });

  it('resetDrawerLog で蓄積がクリアされる', () => {
    mergeServerLog(['a', 'b']);
    resetDrawerLog();
    mergeServerLog(['c']);
    expect(logLines()).toEqual(['c']);
  });
});
