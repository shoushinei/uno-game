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
import { state } from '../state.js';
import { fetchProfileStats, saveCosmetics, type UserStats, type ProfileData } from '../account.js';
import { buildAchievementViews, type AchievementView } from '../achievements.js';
import { ICONS, TITLES, isUnlocked, unlockedAchievementSet } from '../cosmetics.js';
import { syncAccountBar } from './account-bar.js';

declare global {
  interface Window {
    openProfile: () => Promise<void>;
    closeProfile: (event?: Event) => void;
    selectIcon: (emoji: string) => Promise<void>;
    selectTitle: (title: string) => Promise<void>;
  }
}

/** 直近に取得したプロフィールデータ（アイコン・称号の選択で再描画に使う） */
let lastData: ProfileData | null = null;

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
  lastData = data;
  renderProfileBody();
};

window.closeProfile = () => {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
};

function renderProfileBody(): void {
  const body = document.getElementById('profile-body');
  if (body) body.innerHTML = renderProfileHtml(lastData?.displayName ?? null, lastData?.stats ?? null, lastData);
}

// ---- アイコン・称号の選択（Phase 5） ----
window.selectIcon = async (emoji) => {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return;
  const next = state.myIcon === emoji ? null : emoji; // もう一度押すと解除
  state.myIcon = next;
  if (lastData) lastData.selectedIcon = next;
  syncAccountBar();
  renderProfileBody();
  await saveCosmetics(u.uid, { selectedIcon: next });
};

window.selectTitle = async (title) => {
  const u = auth.currentUser;
  if (!u || u.isAnonymous) return;
  const next = (!title || state.myTitle === title) ? null : title; // 「なし」/再選択で解除
  state.myTitle = next;
  if (lastData) lastData.selectedTitle = next;
  syncAccountBar();
  renderProfileBody();
  await saveCosmetics(u.uid, { selectedTitle: next });
};

/** 順位の表示チップ（1〜3位はメダル・それ以外は数字） */
function rankChip(rank: number, playerCount: number): string {
  const label = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`;
  const cls = rank === 1 ? ' win' : '';
  return `<span class="profile-rank-chip${cls}" title="${playerCount}人戦で${rank}位">${label}</span>`;
}

/** 実績バッジ1個のHTML（未解除はグレーでヒント表示） */
function achievementBadge(a: AchievementView): string {
  return `
    <div class="profile-achv${a.unlocked ? ' unlocked' : ''}" title="${a.desc}">
      <span class="profile-achv-emoji">${a.emoji}</span>
      <span class="profile-achv-name">${a.unlocked ? a.name : '???'}</span>
    </div>
  `;
}

/** アイコン・称号の選択UI（解除済みのみ選べる・未解除は🔒） */
function cosmeticsHtml(data: Pick<ProfileData, 'achievements' | 'reactedFirstAt' | 'selectedIcon' | 'selectedTitle'> | null): string {
  const unlocked = unlockedAchievementSet(data);
  const curIcon = data?.selectedIcon ?? null;
  const curTitle = data?.selectedTitle ?? null;

  const iconBtns = ICONS.map(c => {
    const ok = isUnlocked(c, unlocked);
    const sel = curIcon === c.value;
    return `<button class="profile-cos-icon${sel ? ' sel' : ''}${ok ? '' : ' locked'}"${ok ? ` onclick="selectIcon('${c.value}')"` : ' disabled'} title="${ok ? '' : '実績で解除'}">${ok ? c.value : '🔒'}</button>`;
  }).join('');

  const titleBtns = [`<button class="profile-cos-title${!curTitle ? ' sel' : ''}" onclick="selectTitle('')">なし</button>`]
    .concat(TITLES.map(c => {
      const ok = isUnlocked(c, unlocked);
      const sel = curTitle === c.value;
      return `<button class="profile-cos-title${sel ? ' sel' : ''}${ok ? '' : ' locked'}"${ok ? ` onclick="selectTitle('${c.value}')"` : ' disabled'}>${ok ? c.value : '🔒 ' + c.value}</button>`;
    })).join('');

  return `
    <div class="profile-sec">アイコン</div>
    <div class="profile-cos-icons">${iconBtns}</div>
    <div class="profile-sec">称号</div>
    <div class="profile-cos-titles">${titleBtns}</div>
  `;
}

/** モーダル本文のHTML生成（純粋関数・ブラウザ検証やテストから直接呼べるよう export） */
export function renderProfileHtml(
  displayName: string | null,
  stats: UserStats | null,
  data: Pick<ProfileData, 'achievements' | 'reactedFirstAt' | 'selectedIcon' | 'selectedTitle'> | null = null
): string {
  const name = displayName ?? 'プレイヤー';
  const views = buildAchievementViews(data);
  const unlockedCount = views.filter(v => v.unlocked).length;
  const achvHtml = `
    <div class="profile-sec">実績 ${unlockedCount} / ${views.length}</div>
    <div class="profile-achv-grid">${views.map(achievementBadge).join('')}</div>
    ${cosmeticsHtml(data)}
  `;

  if (!stats || !stats.games) {
    return `
      <div class="profile-name">${name}</div>
      <p class="profile-note">まだ対局記録がありません。<br>ゲームを最後までプレイすると記録されます。</p>
      ${achvHtml}
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
    ${achvHtml}
  `;
}
