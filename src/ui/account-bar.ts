// ========================================
// アカウント状態欄（画面右上の固定チップ）
//
// ログイン中のユーザーを常時表示し、クリックでプロフィール（戦績・実績、
// Phase 4以降はフレンドも）を開けるようにする。ホーム画面だけでなく
// ロビー・リザルトでもアカウント機能にアクセスできるようにするのが目的。
// ゲーム中（#s-game / #s-game-pc）やリプレイ中は盤面の邪魔になるため隠す。
// ========================================
import { auth } from '../firebase-config.js';

/** チップを出す画面（それ以外の画面では隠す） */
const SHOW_ON = new Set(['home', 'lobby', 'result']);

/** 表示名（auth.ts がログイン時に確定した名前を渡す） */
let displayName = '';

/** 今アクティブな画面のID（'home' など）を .screen.active から求める */
function activeScreenId(): string {
  const el = document.querySelector('.screen.active');
  return el ? el.id.replace(/^s-/, '') : '';
}

/** 表示名を設定して即座に再描画する */
export function setAccountBarName(name: string): void {
  displayName = name;
  syncAccountBar();
}

/**
 * アカウントチップの表示/非表示と中身を、指定画面（省略時は現在の画面）に
 * 合わせて更新する。ログインしていなければ常に非表示。
 */
export function syncAccountBar(screenId: string = activeScreenId()): void {
  const bar = document.getElementById('account-bar');
  if (!bar) return;
  const user = auth.currentUser;
  const visible = !!user && SHOW_ON.has(screenId);
  bar.style.display = visible ? 'flex' : 'none';
  if (!visible || !user) return;

  const isGuest = !!user.isAnonymous;
  const nameEl = document.getElementById('account-bar-name');
  if (nameEl) nameEl.textContent = displayName || (isGuest ? 'ゲスト' : 'プレイヤー');

  // ゲストはプロフィール・フレンドを持たないのでボタンを隠し、印を出す
  const profileBtn = document.getElementById('account-bar-profile');
  if (profileBtn) profileBtn.style.display = isGuest ? 'none' : 'inline-flex';
  const friendsBtn = document.getElementById('account-bar-friends');
  if (friendsBtn) friendsBtn.style.display = isGuest ? 'none' : 'inline-flex';
  const guestTag = document.getElementById('account-bar-guest');
  if (guestTag) guestTag.style.display = isGuest ? 'inline-flex' : 'none';

  bar.classList.toggle('is-guest', isGuest);
}
