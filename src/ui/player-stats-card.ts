// ========================================
// 他人の戦績カード（★戦績刷新★）
//
// 相手の対局数・勝率（正規化スコア平均）・直近の順位を見られる小さなカード。
// 開き方は2通り:
//  - 対局中: 相手の席（PC UIの席 / 従来UIの対戦相手欄）を長押し（500ms）
//  - フレンド一覧: 各行の 📊 ボタン
// データは users/{uid}（認証済みなら誰でも読める）。ボット・ゲストは
// アカウントが無いので「戦績データがありません」と表示する。
//
// 長押しは pointer イベントで実装（マウス・タッチ両対応）。長押しが発火
// したら直後の click を1回だけ握りつぶし、席クリックのリアクションメニュー
// が同時に開かないようにする。
// ========================================
import { auth } from '../firebase-config.js';
import { fetchProfileStats } from '../account.js';
import { renderStatsSummaryHtml } from './stats-view.js';

declare global {
  interface Window {
    showPlayerStats: (uid: string, name: string) => Promise<void>;
    closePlayerStats: () => void;
  }
}

window.showPlayerStats = async (uid, name) => {
  const modal = document.getElementById('player-stats-modal');
  const body = document.getElementById('player-stats-body');
  const title = document.getElementById('player-stats-name');
  if (!modal || !body) return;
  if (title) title.textContent = `📊 ${name}`;
  modal.style.display = 'flex';
  body.innerHTML = '<p class="profile-note">読み込み中...</p>';

  // ボットはアカウントが無い（uidが bot- 始まり）
  if (!uid || uid.startsWith('bot-')) {
    body.innerHTML = '<p class="profile-note">ボットには戦績がありません</p>';
    return;
  }
  if (!auth.currentUser) {
    body.innerHTML = '<p class="profile-note">戦績を見るにはログインが必要です</p>';
    return;
  }
  const data = await fetchProfileStats(uid);
  if (!data) {
    // users ドキュメントが無い＝ゲスト等のアカウント無しプレイヤー
    body.innerHTML = '<p class="profile-note">戦績データがありません（ゲスト）</p>';
    return;
  }
  body.innerHTML = renderStatsSummaryHtml(data.stats);
};

window.closePlayerStats = () => {
  const modal = document.getElementById('player-stats-modal');
  if (modal) modal.style.display = 'none';
};

// ----------------------------------------
// 長押し検知（席 → 戦績カード）
// ----------------------------------------
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

let pressTimer: ReturnType<typeof setTimeout> | null = null;
let pressStart: { x: number; y: number } | null = null;
/** 長押しが発火した直後の click を握りつぶすための時刻 */
let lastFiredAt = 0;

/** 押した要素から (uid, name) を取り出す。対象外なら null */
function targetFromEvent(e: PointerEvent): { uid: string; name: string } | null {
  const el = e.target as HTMLElement;
  // PC UI の席
  const seat = el.closest<HTMLElement>('.pcg-seat[data-seat-id]');
  if (seat) {
    return {
      uid: seat.dataset.seatId!,
      name: seat.querySelector('.pcg-seat-name')?.textContent?.trim() || 'プレイヤー',
    };
  }
  // 従来UI の対戦相手欄
  const op = el.closest<HTMLElement>('.op[data-player-id]');
  if (op) {
    return {
      uid: op.dataset.playerId!,
      name: op.querySelector('.on')?.textContent?.trim() || 'プレイヤー',
    };
  }
  return null;
}

function cancelPress(): void {
  if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  pressStart = null;
}

document.addEventListener('pointerdown', (e) => {
  const target = targetFromEvent(e);
  if (!target) return;
  cancelPress();
  pressStart = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    lastFiredAt = Date.now();
    void window.showPlayerStats(target.uid, target.name);
  }, LONG_PRESS_MS);
});

document.addEventListener('pointermove', (e) => {
  if (!pressStart) return;
  if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_CANCEL_PX) {
    cancelPress();
  }
});

document.addEventListener('pointerup', cancelPress);
document.addEventListener('pointercancel', cancelPress);

// 長押し発火直後の click（席のリアクションメニュー等）を1回だけ抑止する
document.addEventListener('click', (e) => {
  if (Date.now() - lastFiredAt < 600) {
    e.stopPropagation();
    e.preventDefault();
    lastFiredAt = 0;
  }
}, true);

// モバイルの長押しでOS標準のコンテキストメニューが出ないようにする（席のみ）
document.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement;
  if (el.closest('.pcg-seat[data-seat-id], .op[data-player-id]')) e.preventDefault();
});
