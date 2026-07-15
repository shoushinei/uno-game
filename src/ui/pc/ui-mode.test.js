// ========================================
// ui-mode.ts 単体テスト
//
// isPcUi() はモジュールスコープで判定結果をキャッシュするため、
// テストごとに vi.resetModules() + 動的 import でまっさらな状態から検証する。
// ========================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

function stubEnv({ search = '', ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', width = 1280, coarse = false, hoverHover = true } = {}) {
  const win = {
    location: { search },
    matchMedia: (query) => {
      if (query.includes('pointer: coarse')) return { matches: coarse };
      if (query.includes('hover: hover')) return { matches: hoverHover };
      return { matches: false };
    },
    innerWidth: width,
  };
  // Node 21+ は globalThis.navigator がgetter-onlyのため vi.stubGlobal で上書きする
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { userAgent: ua });
  return win;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('isPcUi', () => {
  it('デスクトップ幅・非タッチ・非モバイルUAなら true', async () => {
    stubEnv({ width: 1280 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(true);
  });

  it('?ui=classic が付いていれば常に false', async () => {
    stubEnv({ search: '?ui=classic', width: 1920 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(false);
  });

  it('?ui=pc が付いていれば狭い幅でも強制的に true', async () => {
    stubEnv({ search: '?ui=pc', width: 400 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(true);
  });

  it('モバイルUA（iPhone）なら幅が広くても false', async () => {
    stubEnv({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', width: 1280 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(false);
  });

  it('タッチのみ（coarse かつ hover不可）なら false（タブレット等）', async () => {
    stubEnv({ width: 1280, coarse: true, hoverHover: false });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(false);
  });

  it('タッチ対応でもマウスも使える（hover:hover）ノートPCは true', async () => {
    stubEnv({ width: 1280, coarse: true, hoverHover: true });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(true);
  });

  it('デスクトップUAでも幅が820未満なら false', async () => {
    stubEnv({ width: 700 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(false);
  });

  it('★重要★ 初回判定後にウィンドウ幅が変わっても、同一セッション中は結果がキャッシュされ変化しない', async () => {
    const win = stubEnv({ width: 1280 });
    const { isPcUi } = await import('./ui-mode.js');
    expect(isPcUi()).toBe(true);
    // 実行中にウィンドウ幅が境界を割り込んだと仮定（devtools開閉等を模擬）
    win.innerWidth = 500;
    // モジュールを再読み込みしない限り、キャッシュされた最初の判定が維持される
    expect(isPcUi()).toBe(true);
  });
});
