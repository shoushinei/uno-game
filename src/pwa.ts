/// <reference types="vite-plugin-pwa/client" />
// ========================================
// PWA（Service Worker）の登録と更新通知
//
// app.ts とは別のエントリ。index.html で app.ts より前に読み込む。
// app.ts は import が多く、どれかが失敗すると本文まで到達しないため、
// SW の登録だけは巻き込まれないよう独立させている。
// （ただし Firebase SDK は CDN からの静的 import なのでバンドル先頭に
//   巻き上げられる。ごく初回に gstatic へ到達できない場合だけは
//   ここまで実行が来ない。2回目以降は SW がSDKをキャッシュから返す）
//
// Service Worker は「キャッシュ優先」で動くため、こちらが新版をデプロイしても
// 端末側は古いままになりうる。そこで新版を検知したらトーストで知らせ、
// ユーザーが押したときだけ再読込する。
//
// ★対戦中は絶対に再読込を促さない★
// リアルタイム対戦の最中にリロードさせると、手番・演出・対決オーバーレイの
// 途中で画面が飛ぶ。検知しても保留しておき、ホーム／ロビー／終了後など
// 「安全な場面」になってから初めてトーストを出す。
// ========================================
import { registerSW } from 'virtual:pwa-register';

/** 安全な場面か（＝ゲーム進行中でないか） */
function isSafeToPrompt(): boolean {
  // ルームに入っていない・ロビーで待機中・ゲーム終了後なら中断されて困るものはない
  const s = window._roomState;
  return !s || s === 'lobby' || s === 'ended';
}

let toastEl: HTMLElement | null = null;

function showUpdateToast(onUpdate: () => void): void {
  if (toastEl) return; // 二重表示しない
  const el = document.createElement('div');
  el.className = 'pwa-update-toast';
  el.innerHTML =
    '<span class="pwa-update-text"><b>新しいバージョンがあります</b><br>更新すると最新の状態になります</span>' +
    '<button type="button" class="pwa-update-btn">更新</button>' +
    '<button type="button" class="pwa-update-close" aria-label="閉じる">✕</button>';
  document.body.appendChild(el);
  toastEl = el;

  el.querySelector('.pwa-update-btn')?.addEventListener('click', () => {
    el.querySelector('.pwa-update-btn')!.textContent = '更新中…';
    onUpdate();
  });
  el.querySelector('.pwa-update-close')?.addEventListener('click', () => {
    el.remove();
    toastEl = null;
  });
}

function installPwa(): void {
  // Service Worker はHTTPS（またはlocalhost）でしか動かない。
  // 非対応環境では何もせず、従来どおり普通のWebページとして動く
  if (!('serviceWorker' in navigator)) return;

  let pending = false;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pending = true;
      tryPrompt();
    },
    onRegisteredSW(_url, registration) {
      // 起動時とその後1時間ごとに新版の有無を確認する。
      // これをしないと、ずっと開きっぱなしの端末が更新に気づかない
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => { /* 無視 */ });
      }, 60 * 60 * 1000);
    },
  });

  function tryPrompt(): void {
    if (!pending) return;
    if (isSafeToPrompt()) {
      showUpdateToast(() => updateSW(true));
      pending = false;
      return;
    }
    // 対戦中なら諦めずに待つ（終わった頃に出す）
    setTimeout(tryPrompt, 10_000);
  }
}

installPwa();
