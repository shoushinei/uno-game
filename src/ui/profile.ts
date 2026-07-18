// ========================================
// プロフィール画面（Phase 2: 戦績の最小表示）
//
// ホームの「📊 プロフィール」から開くモーダル。勝率・総ゲーム数・
// 連勝/連敗・直近5戦を表示する。データは Cloud Functions が書いた
// users/{uid}.stats（クライアントは読み取り専用）。
// Phase 3（実績）・Phase 5（アイコン選択）はこの画面にタブ/セクションを
// 追加していく前提の骨組み。
// ========================================
import { auth } from '../firebase-config.js';
import { fetchProfileStats, type UserStats } from '../account.js';

declare global {
  interface Window {
    openProfile: () => Promise<void>;
    closeProfile: (event?: Event) => void;
  }
}

window.openProfile = async () => {
  const modal = document.getElementById('profile-modal');
  const body = document.getElementById('profile-body');
  if (!modal || !body) return;
  modal.style.display = 'flex';
  body.innerHTML = '<p class="profile-note">読み込み中...</p>';

  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    body.innerHTML = '<p class="profile-note">ゲストにはプロフィールがありません</p>';
    return;
  }
  const data = await fetchProfileStats(user.uid);
  body.innerHTML = renderProfileHtml(data?.displayName ?? null, data?.stats ?? null);
};

window.closeProfile = () => {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
};

/** 順位の表示チップ（1〜3位はメダル・それ以外は数字） */
function rankChip(rank: number, playerCount: number): string {
  const label = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`;
  const cls = rank === 1 ? ' win' : '';
  return `<span class="profile-rank-chip${cls}" title="${playerCount}人戦で${rank}位">${label}</span>`;
}

/** モーダル本文のHTML生成（純粋関数・ブラウザ検証やテストから直接呼べるよう export） */
export function renderProfileHtml(displayName: string | null, stats: UserStats | null): string {
  const name = displayName ?? 'プレイヤー';
  if (!stats || !stats.games) {
    return `
      <div class="profile-name">${name}</div>
      <p class="profile-note">まだ対局記録がありません。<br>ゲームを最後までプレイすると記録されます。</p>
    `;
  }
  const rate = Math.round((stats.wins / stats.games) * 100);
  const streak = stats.winStreak > 0
    ? `<span class="profile-streak win">🔥 ${stats.winStreak}連勝中</span>`
    : stats.loseStreak > 1
    ? `<span class="profile-streak">💧 ${stats.loseStreak}連敗中</span>`
    : '';
  const recent = (stats.recent ?? [])
    .map(r => rankChip(r.rank, r.playerCount))
    .join('');
  return `
    <div class="profile-name">${name} ${streak}</div>
    <div class="profile-stats-grid">
      <div class="profile-stat"><div class="profile-stat-num">${stats.games}</div><div class="profile-stat-label">対局数</div></div>
      <div class="profile-stat"><div class="profile-stat-num">${stats.wins}</div><div class="profile-stat-label">1位</div></div>
      <div class="profile-stat"><div class="profile-stat-num">${rate}%</div><div class="profile-stat-label">勝率</div></div>
    </div>
    <div class="profile-sec">直近${(stats.recent ?? []).length}戦（新しい順）</div>
    <div class="profile-recent">${recent || '<span class="profile-note">なし</span>'}</div>
  `;
}
