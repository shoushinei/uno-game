import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages のサブディレクトリ公開なので、PWA の scope / start_url も
// このベースパスに揃える必要がある。ズレるとホーム画面のアイコンから
// 起動したときに404になる。
const BASE = '/uno-game/';

export default defineConfig({
  base: BASE, // GitHub Pagesで公開する場合のベースパス
  server: {
    port: 3000, // 開発サーバーのポート番号
  },
  plugins: [
    VitePWA({
      // 登録は src/pwa.ts で自前で行う（更新トーストを出したいため）
      injectRegister: null,
      registerType: 'prompt',

      // public/ 配下でプリキャッシュに含めたいもの
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon-32.png'],

      manifest: {
        id: BASE,
        name: '大富豪 × UNO',
        short_name: '大富豪UNO',
        description: 'トランプ（大富豪）とUNOを同時進行させるリアルタイム対戦カードゲーム',
        lang: 'ja',
        start_url: BASE,
        scope: BASE,
        // これがアプリらしさの正体。ホーム画面から起動するとアドレスバーが消える
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0d1f18',
        theme_color: '#0d1f18',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Android は円などに切り抜くので、余白を持たせた版を別に用意する
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // オフラインでもアプリの画面までは出す（対戦自体は当然ネットが要る）
        navigateFallback: BASE + 'index.html',
        cleanupOutdatedCaches: true,

        // ★最重要★
        // RTDB(*.firebaseio.com) と Firestore(firestore.googleapis.com) の通信は
        // 絶対にキャッシュしない。ここを取り違えると「相手がカードを出したのに
        // 自分の画面だけ更新されない」という再現困難な同期バグになる。
        // これらは別オリジンなので既定では Service Worker のキャッシュ対象外だが、
        // 事故防止のため runtimeCaching には意図的に一切追加していない。
        // （RTDB は WebSocket なのでそもそも SW を通らない）
        runtimeCaching: [
          {
            // Firebase SDK は CDN から読んでいる（firebase-config.ts）ので
            // ここだけはキャッシュして起動を速くする。バージョン固定URLなので安全
            urlPattern: /^https:\/\/www\.gstatic\.com\/firebasejs\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-sdk',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
