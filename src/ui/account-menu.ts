// ========================================
// アカウントメニュー（右上チップの名前をタップで開く）
//
// ログアウト／アカウント切替の入口。チップに🚪を直接足すと
// 🤝📊🚪 と3つ並んで 320px 端末で名前が潰れるうえ、1タップで
// 発火するので押し間違いが怖い。1枚かぶせて選ばせる形にした。
//
// ★出し方は第3段で統一した作法に乗る★ 📱=ボトムシート／🖥=中央モーダル。
//   .modal-overlay > .modal-content の共通CSSがそのまま効くので、
//   ここでは中身を差し込むだけでよい。
//
// 実際のログアウト処理（signOut・退室・後始末）は auth.ts が持つ。
// このファイルは「開く・閉じる・描く」だけを担当する。
// ========================================
import { auth } from '../firebase-config.js';
import { state } from '../state.js';
import { accountKind, buildAccountMenuHtml } from '../logout-logic.js';
import { getAccountBarName } from './account-bar.js';
import { performLogout } from '../auth.js';

declare global {
  interface Window {
    openAccountMenu: () => void;
    closeAccountMenu: () => void;
    switchAccount: () => Promise<void>;
    logoutAccount: () => Promise<void>;
    // closeMobileSheets は mobile-player-sheet.ts が宣言・登録している
  }
}

window.openAccountMenu = () => {
  const user = auth.currentUser;
  if (!user) return;
  const modal = document.getElementById('account-menu-modal');
  const body = document.getElementById('account-menu-body');
  if (!modal || !body) return;

  // ☰メニューやプレイヤーシートが開いていたら閉じる（重ねない）
  window.closeMobileSheets?.();

  const kind = accountKind({
    isAnonymous: !!user.isAnonymous,
    providerIds: (user.providerData ?? []).map((p: any) => p?.providerId).filter(Boolean),
  });
  body.innerHTML = buildAccountMenuHtml({
    name: getAccountBarName(),
    kind,
    icon: kind === 'guest' ? null : state.myIcon,
    title: kind === 'guest' ? null : state.myTitle,
  });
  modal.style.display = 'flex';
};

window.closeAccountMenu = () => {
  const modal = document.getElementById('account-menu-modal');
  if (modal) modal.style.display = 'none';
};

window.switchAccount = async () => {
  await performLogout('switch');
};

window.logoutAccount = async () => {
  await performLogout('logout');
};
