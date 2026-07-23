// ========================================
// ヨット（Yacht）の純粋ロジック — ヨットモード Step 1
//
// スキル対決用ミニゲーム。5個のサイコロを振り、最大2回振り直して
// 「最高得点の役」1つで勝負する（1ラウンド決着・合意済み仕様）。
//
// 役と点数（合意済み）:
//  - ヨット            : 5個全て同じ目 → 50点
//  - ビッグストレート  : 5連続(1-5 or 2-6) → 30点
//  - スモールストレート: 4連続を含む → 15点
//  - フルハウス        : 3個+別の2個 → 5個の目の合計
//  - フォーナンバーズ  : 少なくとも4個同じ → 5個の目の合計
//  - 1〜6              : その目だけの合計
//
// ※「チョイス（無条件で5個の合計）」は強すぎて役作りの駆け引きが薄れるため
//   廃止した。役なしのときの得点は「一番数の多い目の合計」が上限になる。
//
// DOM・Firebase 非依存。乱数は注入可能（テスト・リプレイ用）。
// ========================================

/** サイコロの目（1〜6）5個 */
export type Dice = number[];

export interface HandScore {
  /** 役ID（表示メタは UI 側で持つ） */
  category: string;
  /** 点数 */
  score: number;
}

/** 1人分の対決状態: 振った回数は初回1 + 振り直し最大2 = 最大3回 */
export const MAX_ROLLS = 3;
export const DICE_COUNT = 5;

/** サイコロを n 個振る（rand 注入可能） */
export function rollDice(n: number, rand: () => number = Math.random): number[] {
  return Array.from({ length: n }, () => 1 + Math.floor(rand() * 6));
}

/**
 * 残す目（keepFlags[i]=true は保持）以外を振り直した新しい5個を返す。
 * 入力は変更しない。
 */
export function reroll(dice: Dice, keepFlags: boolean[], rand: () => number = Math.random): Dice {
  return dice.map((d, i) => (keepFlags[i] ? d : 1 + Math.floor(rand() * 6)));
}

/** 目ごとの個数 [_,1の数,2の数,...,6の数]（index 0 は未使用） */
function countByFace(dice: Dice): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d] = (c[d] ?? 0) + 1;
  return c;
}

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

/** 全役のスコア一覧（UI のスコア表と最高役判定に使う） */
export function scoreAll(dice: Dice): HandScore[] {
  const c = countByFace(dice);
  const total = sum(dice);
  const out: HandScore[] = [];

  // ヨット: 5個同じ
  out.push({ category: 'yacht', score: c.includes(5) ? 50 : 0 });

  // ストレート判定用: 存在する目の集合
  const faces = new Set(dice);
  const hasRun = (start: number, len: number): boolean => {
    for (let i = 0; i < len; i++) if (!faces.has(start + i)) return false;
    return true;
  };
  const big = hasRun(1, 5) || hasRun(2, 5);
  out.push({ category: 'big-straight', score: big ? 30 : 0 });
  const small = hasRun(1, 4) || hasRun(2, 4) || hasRun(3, 4);
  out.push({ category: 'small-straight', score: small ? 15 : 0 });

  // フルハウス: 3個+別の2個（5個同一は含まない）
  const fullHouse = c.includes(3) && c.includes(2);
  out.push({ category: 'full-house', score: fullHouse ? total : 0 });

  // フォーナンバーズ: 少なくとも4個同じ（5個同一も含む）
  const four = c.some(n => n >= 4);
  out.push({ category: 'four-numbers', score: four ? total : 0 });

  // 1〜6: その目の合計
  // （チョイス廃止。役なしはここが最高得点になる）
  for (let f = 1; f <= 6; f++) {
    out.push({ category: String(f), score: (c[f] ?? 0) * f });
  }
  return out;
}

/**
 * 役の同点タイブレーク用の「格の順」（表示のかっこよさ優先。点数が同じなら
 * この並びで先の役名を採用する。勝敗判定はあくまで score のみで行う）
 */
const CATEGORY_RANK = [
  'yacht', 'big-straight', 'four-numbers', 'full-house', 'small-straight',
  '6', '5', '4', '3', '2', '1',
];

/** 最高得点の役を1つ返す（合意仕様: この1つの点数だけで勝負する） */
export function bestHand(dice: Dice): HandScore {
  const all = scoreAll(dice);
  let best = all[0]!;
  for (const h of all) {
    if (h.score > best.score) best = h;
    else if (h.score === best.score &&
      CATEGORY_RANK.indexOf(h.category) < CATEGORY_RANK.indexOf(best.category)) {
      best = h;
    }
  }
  return best;
}

/**
 * 勝敗判定。攻撃側スコア vs 守備側スコア。
 * 'attacker' | 'defender' = その側の勝ち / 'draw' = 引き分け（誰も引かない）
 */
export function judgeDuel(attackerScore: number, defenderScore: number): 'attacker' | 'defender' | 'draw' {
  if (attackerScore > defenderScore) return 'attacker';
  if (defenderScore > attackerScore) return 'defender';
  return 'draw';
}
