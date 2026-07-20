// ========================================
// 戦績サマリの共通表示（★戦績刷新★）
//
// プロフィールモーダル（自分）と他人の戦績カード（席の長押し・フレンド）で
// 共有するHTML生成。純粋関数のみ（DOM・Firebase非依存）。
//
// 勝率 = 正規化スコアの平均。(人数-順位)/(人数-1)*100 をゲームごとに算出し
// 平均する。1位=100 / 最下位=0 / 全順位の平均=50 なので、3〜8人の卓の
// 人数差を吸収して比較できる（50%が「平均的な成績」の基準線）。
// ボットなし（全員人間）とボット入りの卓は別集計で表示する。
// ========================================
import type { UserStats } from '../account.js';

/** バケットの平均スコア（0〜100・整数丸め）。未集計は null */
export function avgScore(b: { games: number; scoreSum: number } | undefined | null): number | null {
  if (!b || !b.games) return null;
  return Math.round(b.scoreSum / b.games);
}

/** 順位の表示チップ（1〜3位はメダル・それ以外は数字。ボット入り卓は🤖印） */
export function rankChip(rank: number, playerCount: number, hasBots?: boolean): string {
  const label = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}位`;
  const cls = rank === 1 ? ' win' : '';
  const bots = hasBots ? '<span class="profile-chip-bots">🤖</span>' : '';
  return `<span class="profile-rank-chip${cls}" title="${playerCount}人戦で${rank}位${hasBots ? '（ボット入り）' : ''}">${label}${bots}</span>`;
}

/**
 * 戦績サマリのHTML（バケット2行＋直近5戦）。
 * 記録なしの場合は案内文だけ返す。
 */
export function renderStatsSummaryHtml(stats: UserStats | null): string {
  if (!stats || !stats.games) {
    return '<p class="profile-note">まだ対局記録がありません。<br>ゲームを最後までプレイすると記録されます。</p>';
  }
  const row = (label: string, b: { games: number; scoreSum: number } | undefined) => {
    const a = avgScore(b);
    return `
      <div class="stats-bucket">
        <span class="stats-bucket-label">${label}</span>
        <span class="stats-bucket-games">対局 ${b?.games ?? 0}</span>
        <span class="stats-bucket-rate">勝率 ${a === null ? '—' : a + '%'}</span>
      </div>`;
  };
  const recent = (stats.recent ?? [])
    .map(r => rankChip(r.rank, r.playerCount, r.hasBots))
    .join('');
  return `
    ${row('👥 ボットなし', stats.human)}
    ${row('🤖 ボット入り', stats.withBots)}
    <div class="profile-sec" style="margin-top:8px">直近${(stats.recent ?? []).length}戦（新しい順）</div>
    <div class="profile-recent">${recent || '<span class="profile-note">なし</span>'}</div>
  `;
}
