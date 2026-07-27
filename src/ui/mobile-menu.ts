// ========================================
// ★モバイルUI M2★ ☰メニューシート（下から出る）
//
// 5層100dvhレイアウトにしたことで盤面に置けなくなった
// 「常時は要らない情報と操作」の置き場。
//   リアクション / いまの状況（フェイズ・順番・現在の色）/ ログ /
//   自動プレイ・バグ報告・退室
//
// シート内の要素は元のIDのまま置いてあるので、ui-render.ts の
// 描画関数（_renderLog / _renderTurnOrder 等）は変更不要で動き続ける。
// ========================================

import { isSoundOn, toggleSound } from '../audio/audio-engine.js';

declare global {
  interface Window {
    openMobileMenu: (section?: string) => void;
    closeMobileMenu: () => void;
    toggleMobileSound: () => void;
  }
}

/** 効果音ボタンのラベルを今の状態に合わせる */
function syncSoundButton(): void {
  const btn = document.getElementById('mg-sound-btn');
  if (!btn) return;
  const on = isSoundOn();
  btn.textContent = on ? '🔊 効果音 ON' : '🔇 効果音 OFF';
  btn.classList.toggle('off', !on);
}

function screenEl(): HTMLElement | null {
  return document.getElementById('s-game');
}

export function openMobileMenu(section?: string): void {
  const el = screenEl();
  if (!el) return;
  el.classList.remove('player-open'); // ★M3★ プレイヤーのシートとは排他にする
  el.classList.add('menu-open');
  syncSoundButton(); // 開くたびに今の設定を反映する
  const sheet = document.getElementById('mg-sheet');
  if (!sheet) return;
  // 「😀」から開いたときはリアクションが目に入る位置から始める
  sheet.scrollTop = 0;
  if (section === 'react') return;
  // ☰から開いた直後にログを最新まで送っておく
  const log = document.getElementById('glog');
  if (log) log.scrollTop = log.scrollHeight;
}

export function closeMobileMenu(): void {
  screenEl()?.classList.remove('menu-open');
}

/** 送信後に自動で閉じる（リアクションを1つ投げたら盤面へ戻す） */
export function installMobileMenu(): void {
  window.openMobileMenu = openMobileMenu;
  window.closeMobileMenu = closeMobileMenu;
  // 効果音のON/OFF。シートは開いたままラベルだけ更新する
  // （PC UIは引き出しパネルのフッターに同じトグルがある）
  window.toggleMobileSound = () => {
    toggleSound();
    syncSoundButton();
  };

  document.getElementById('mg-sheet')?.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest('.react-btn');
    if (btn) setTimeout(closeMobileMenu, 180); // 送信の見た目が出てから閉じる
  });

  // 退室などで盤面から離れたときに開きっぱなしにしない
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.closeMobileSheets?.();
  });
}
