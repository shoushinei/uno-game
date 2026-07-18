// ========================================
// 実績のメタ情報と解除状態の集計（Phase 3・フロント側）
//
// 判定は Cloud Functions（functions/src/achievements-logic.ts）がサーバー側で
// 行い、users/{uid}.achievements（id→解除時刻ms）に書き込む。ここはその
// 「表示のためのメタ情報（絵文字・名前・説明）」と、ユーザードキュメントから
// 「解除済み一覧」を組み立てる純粋関数だけを持つ。
//
// ★ID契約★ 下の id は functions 側 evaluateAchievements が返すIDと一致させる。
// 例外: 'reaction-first'（対人リアクション初送信）だけはクライアント記録で、
//        users/{uid}.reactedFirstAt に本人が書く（Functions判定外）。
// ========================================

export interface AchievementMeta {
  id: string;
  emoji: string;
  name: string;
  /** 解除条件の説明（未解除のときヒントとして出す） */
  desc: string;
}

export const ACHIEVEMENTS: AchievementMeta[] = [
  { id: 'first-game',     emoji: '🎮', name: 'はじめの一歩',       desc: 'はじめてゲームを最後までプレイする' },
  { id: 'first-win',      emoji: '👑', name: '初勝利',             desc: 'はじめて1位になる' },
  { id: 'games-10',       emoji: '🏁', name: '常連プレイヤー',     desc: '通算10ゲームをプレイする' },
  { id: 'double-finish',  emoji: '⚡', name: '同時上がり',         desc: '同じターンでトランプとUNOを両方出し切って上がる' },
  { id: 'uno-declare-5',  emoji: '📢', name: 'UNOコール',          desc: '通算5回「UNO！」を宣言する' },
  { id: 'revolution',     emoji: '🌀', name: '革命家',             desc: '革命（4枚以上出し）を起こす' },
  { id: 'eight-cut',      emoji: '✂️', name: '8切りの達人',        desc: '8切りで場を流す' },
  { id: 'streak-win-3',   emoji: '🔥', name: '3連勝',             desc: '3連勝する' },
  { id: 'streak-lose-3',  emoji: '💧', name: 'ドンマイ',           desc: '3連敗する（次はきっと勝てる）' },
  { id: 'reaction-first', emoji: '🍅', name: 'ちょっかい',         desc: '対人リアクションをはじめて投げる' },
];

/** 解除済みか＋解除時刻を1件にまとめた表示用の形 */
export interface AchievementView extends AchievementMeta {
  unlocked: boolean;
  at: number | null;
}

/**
 * ユーザードキュメントのデータから、全実績の解除状態を組み立てる。
 * - サーバー実績: data.achievements（id→ms）
 * - クライアント実績: data.reactedFirstAt（reaction-first）
 * 解除済みを先頭、未解除を後ろにして返す。
 */
export function buildAchievementViews(data: {
  achievements?: Record<string, number> | null;
  reactedFirstAt?: number | null;
} | null | undefined): AchievementView[] {
  const server = (data?.achievements ?? {}) as Record<string, number>;
  const reactedAt = typeof data?.reactedFirstAt === 'number' ? data!.reactedFirstAt! : null;

  const views = ACHIEVEMENTS.map((m): AchievementView => {
    let at: number | null = null;
    if (m.id === 'reaction-first') at = reactedAt;
    else if (typeof server[m.id] === 'number') at = server[m.id]!;
    return { ...m, unlocked: at !== null, at };
  });
  // 解除済みを先に（解除が新しい順）、未解除は定義順で後ろへ
  return views.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
    if (a.unlocked && b.unlocked) return (b.at ?? 0) - (a.at ?? 0);
    return 0;
  });
}

/** id → メタ情報（トースト表示などで使う） */
export function achievementMeta(id: string): AchievementMeta | undefined {
  return ACHIEVEMENTS.find(a => a.id === id);
}
