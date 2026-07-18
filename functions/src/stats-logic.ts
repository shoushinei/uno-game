// ========================================
// 戦績集計の純粋ロジック（Phase 2）
//
// Cloud Functions 本体（index.ts）から使う。Firebase に依存しない
// 純粋関数として分離し、ルートの vitest でテストする。
//
// 用語の定義（合意済みの仕様）:
// - 「勝ち」= 1位。「負け」= 1位以外（最下位に限らない）
// - winStreak / loseStreak は「現在続いている」連勝/連敗数
//   （Phase 3 の実績「3連勝」「3連敗」の判定にそのまま使う）
// - recent は新しい順で最大5件（プロフィールの「直近5戦」表示用）
// ========================================

/** 1ゲーム分の結果 */
export interface GameOutcome {
  /** 最終順位（1始まり） */
  rank: number;
  /** そのゲームの総参加人数（ボット・ゲスト込みの卓の人数） */
  playerCount: number;
  /** ゲーム終了時刻（epoch ms） */
  at: number;
}

/** users/{uid}.stats の形 */
export interface UserStats {
  games: number;
  wins: number;
  winStreak: number;
  loseStreak: number;
  recent: GameOutcome[];
}

export const RECENT_MAX = 5;

/**
 * 既存の集計（無ければ null）に1ゲームの結果を適用した新しい集計を返す。
 * 入力は変更しない。壊れた既存データ（数値でない等）は0扱いで自己修復する。
 */
export function applyGameResult(
  prev: Partial<UserStats> | null | undefined,
  game: GameOutcome
): UserStats {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const isWin = game.rank === 1;
  const prevRecent = Array.isArray(prev?.recent) ? prev!.recent! : [];
  return {
    games: n(prev?.games) + 1,
    wins: n(prev?.wins) + (isWin ? 1 : 0),
    winStreak: isWin ? n(prev?.winStreak) + 1 : 0,
    loseStreak: isWin ? 0 : n(prev?.loseStreak) + 1,
    recent: [game, ...prevRecent].slice(0, RECENT_MAX),
  };
}
