// ========================================
// アイコン・称号の定義（Phase 5・フロント側の純粋モジュール）
//
// アイコン（絵文字）と称号を定義する。基本（誰でも選べる）と、実績連動
// （特定の実績を解除すると選べるようになる）の2種類。
//
// 選択結果は users/{uid}.selectedIcon / selectedTitle に保存する
// （Phase 1 のルールで本人のみ書き込み可）。ゲーム席・ロビーへは参加時に
// players[] へ絵文字/称号テキストを埋め込んで配る（表示側は本モジュール非依存）。
//
// unlock=null は誰でも。unlock=実績ID はその実績を解除していれば選べる
// （実績IDは achievements.ts / functions 側と一致）。
// ========================================

export interface Cosmetic {
  /** アイコンは絵文字そのもの、称号は表示テキスト（そのまま players[] に載る） */
  value: string;
  /** null=誰でも / 実績ID=その実績の解除で選択可能 */
  unlock: string | null;
}

/** アイコン（絵文字）。先頭の基本枠は誰でも、後半は実績連動 */
export const ICONS: Cosmetic[] = [
  { value: '🙂', unlock: null },
  { value: '😎', unlock: null },
  { value: '😺', unlock: null },
  { value: '🐶', unlock: null },
  { value: '🐰', unlock: null },
  { value: '🐸', unlock: null },
  { value: '🐼', unlock: null },
  { value: '🦊', unlock: null },
  { value: '🐧', unlock: null },
  { value: '🍎', unlock: null },
  { value: '⭐', unlock: null },
  { value: '🎩', unlock: null },
  // ---- 実績連動 ----
  { value: '👑', unlock: 'first-win' },
  { value: '🏆', unlock: 'games-10' },
  { value: '🔥', unlock: 'streak-win-3' },
  { value: '🌀', unlock: 'revolution' },
  { value: '✂️', unlock: 'eight-cut' },
  { value: '⚡', unlock: 'double-finish' },
  // ---- ★M4で追加した実績に対応するアイコン ----
  // 実績の絵文字と重ならないものを選び、「何を達成した人か」が一目で分かるようにする
  { value: '🪜', unlock: 'stairs' },
  { value: '🃏', unlock: 'joker-single' },
  { value: '♠️', unlock: 'spade-three' },
  { value: '💥', unlock: 'draw-stack' },
  { value: '⚔', unlock: 'yacht-first' },
  { value: '🌟', unlock: 'yacht-best' },
  { value: '🎲', unlock: 'yacht-win-3' },
  { value: '🎨', unlock: 'parent-color-5' },
  { value: '🏅', unlock: 'win-10' },
  { value: '🦁', unlock: 'games-50' },
];

/** 称号（すべて実績連動。デフォルトは「なし」） */
export const TITLES: Cosmetic[] = [
  { value: '初勝利', unlock: 'first-win' },
  { value: '常連プレイヤー', unlock: 'games-10' },
  { value: '連勝王', unlock: 'streak-win-3' },
  { value: '革命家', unlock: 'revolution' },
  { value: '8切りの達人', unlock: 'eight-cut' },
  { value: '同時上がりの使い手', unlock: 'double-finish' },
  // ---- ★M4で追加 ----
  { value: '階段名人', unlock: 'stairs' },
  { value: '切り札の使い手', unlock: 'joker-single' },
  { value: 'ジョーカー返し', unlock: 'spade-three' },
  { value: 'カウンターの達人', unlock: 'draw-stack' },
  { value: '果たし状', unlock: 'yacht-first' },
  { value: 'ヨットの主', unlock: 'yacht-best' },
  { value: '賭博師', unlock: 'yacht-win-3' },
  { value: '親の威厳', unlock: 'parent-color-5' },
  { value: '十冠王', unlock: 'win-10' },
  { value: 'ベテラン', unlock: 'games-50' },
];

/** その装飾が解除されているか（unlock=null は常に true） */
export function isUnlocked(c: Cosmetic, unlockedAchievements: Set<string>): boolean {
  return c.unlock === null || unlockedAchievements.has(c.unlock);
}

/**
 * ユーザーデータ（achievements マップ＋reactedFirstAt）から
 * 解除済み実績IDの集合を作る（cosmetics の解除判定に使う）。
 */
export function unlockedAchievementSet(data: {
  achievements?: Record<string, number> | null;
  reactedFirstAt?: number | null;
} | null | undefined): Set<string> {
  const s = new Set<string>(Object.keys(data?.achievements ?? {}));
  if (typeof data?.reactedFirstAt === 'number') s.add('reaction-first');
  return s;
}
