import { defineConfig } from 'vite';

export default defineConfig({
  base: '/uno-game/', // GitHub Pagesで公開する場合のベースパス
  server: {
    port: 3000, // 開発サーバーのポート番号
  }
});