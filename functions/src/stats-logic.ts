// ========================================
// 戦績集計の純粋ロジック（Phase 2 / 戦績刷新）
//
// Cloud Functions 本体（index.ts）から使う。Firebase に依存しない
// 純粋関数として分離し、ルートの vitest でテストする。
//
// 用語の定義（合意済みの仕様）:
// - 「勝ち」= 1位。「負け」= 1位以外（実績の連勝/連敗判定に使う）
// - winStreak / loseStreak は「現在続いている」連勝/連敗数
// - recent は新しい順で最大5件（プロフィールの「直近5戦」表示用）
// - ★戦績刷新★ 勝率は「正規化スコア」= (人数-順位)/(人数-1)*100 の平均。
//   3〜8人と卓の人数が変わっても、1位=100 / 最下位=0 / 全順位の平均=50 に
//   なるため人数差を吸収して比較できる（例: 4人戦2位=66.7）
// - ★戦績刷新★ ボット入りの卓とボットなし（全員人間）の卓は集計を分ける
//   （human / withBots バケット。games と scoreSum を持ち、表示側で平均を出す）
// ========================================

/** 1ゲーム分の結果 */
export interface GameOutcome {
  /** 最終順位（1始まり） */
  rank: number;
  /** そのゲームの総参加人数（ボット・ゲスト込みの卓の人数） */
  playerCount: number;
  /** ゲーム終了時刻（epoch ms） */
  at: number;
  /** その卓にボットが1体でもいたか（ボット入り/なしの集計分け・表示に使う） */
  hasBots?: boolean;
}

/** ボット入り/なし それぞれの集計バケット */
export interface StatsBucket {
  games: number;
  /** 正規化スコアの合計（表示側で scoreSum/games を平均スコアとして出す） */
  scoreSum: number;
}

/** users/{uid}.stats の形 */
export interface UserStats {
  games: number;
  wins: number;
  winStreak: number;
  loseStreak: number;
  recent: GameOutcome[];
  /** ボットなし（全員人間）の卓の集計 */
  human: StatsBucket;
  /** ボット入りの卓の集計 */
  withBots: StatsBucket;
}

export const RECENT_MAX = 5;

/**
 * 順位の正規化スコア（0〜100）。1位=100・最下位=0・線形補間。
 * 各順位のスコアを全部足して人数で割るとちょうど50になる。
 */
export function rankScore(rank: number, playerCount: number): number {
  if (playerCount < 2) return 50; // 想定外（最低3人）だが0除算だけ防ぐ
  return ((playerCount - rank) / (playerCount - 1)) * 100;
}

/**
 * 既存の集計（無ければ null）に1ゲームの結果を適用した新しい集計を返す。
 * 入力は変更しない。壊れた既存データ（数値でない等）は0扱いで自己修復する。
 * 旧形式（human/withBots が無い）の既存データもここで自然に移行される
 * （旧ゲーム分はバケットに含まれず、導入後のゲームから集計される）。
 */
export function applyGameResult(
  prev: Partial<UserStats> | null | undefined,
  game: GameOutcome
): UserStats {
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const bucket = (b: Partial<StatsBucket> | undefined): StatsBucket => ({
    games: n(b?.games),
    scoreSum: n(b?.scoreSum),
  });
  const isWin = game.rank === 1;
  const prevRecent = Array.isArray(prev?.recent) ? prev!.recent! : [];

  const human = bucket(prev?.human);
  const withBots = bucket(prev?.withBots);
  const target = game.hasBots ? withBots : human;
  target.games += 1;
  target.scoreSum += rankScore(game.rank, game.playerCount);

  return {
    games: n(prev?.games) + 1,
    wins: n(prev?.wins) + (isWin ? 1 : 0),
    winStreak: isWin ? n(prev?.winStreak) + 1 : 0,
    loseStreak: isWin ? 0 : n(prev?.loseStreak) + 1,
    recent: [game, ...prevRecent].slice(0, RECENT_MAX),
    human,
    withBots,
  };
}
