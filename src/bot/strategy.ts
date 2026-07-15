// ========================================
// ボットの思考ロジック（純粋関数・DOM/Firebase非依存・テスト対象）
//
// 「今のゲーム状態と、あるプレイヤーの手札」から「次に取るべき1手（プラン）」を
// 決定する。実行（Firebaseへの書き込み）は execute.ts が担当する。
//
// これを純粋関数として切り出すことで:
//   - test-bot（自分を自動操作）
//   - absent-runner（退室者をホストが代行）
// の両方が同じ「頭脳」を共有でき、かつ単体テストできる。
// ========================================
import { trumpCanPlay, type TrumpCard } from '../logic/trump-logic.js';
import { unoCanPlay } from '../logic/uno-logic.js';
import type { UnoCard } from '../logic/types';

/** ボットが決定する1手 */
export type BotPlan =
  | { kind: 'trumpPlay'; cardIds: string[] }
  | { kind: 'trumpPass' }
  | { kind: 'trumpSkip' }
  | { kind: 'parentColor'; color: string }
  | { kind: 'unoSkip' }
  | { kind: 'unoPlay'; idx: number; color: string | null; sayUnoFirst: boolean }
  | { kind: 'unoDraw' }
  | { kind: 'none' };

const UNO_COLORS = ['red', 'blue', 'green', 'yellow'];

/** トランプ：出せる最初の1枚（単騎）を探す */
function findPlayableTrumpSingle(hand: TrumpCard[], fieldCards: TrumpCard[], g: any): TrumpCard | null {
  for (const card of hand) {
    if (trumpCanPlay([card], fieldCards, g)) return card;
  }
  return null;
}

/** UNO：出せる最初の1枚のインデックスを探す（無ければ -1） */
function findPlayableUnoIdx(hand: UnoCard[], top: UnoCard, currentColor: string, penaltyAccum: number): number {
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    if (card && unoCanPlay(card, top, currentColor, penaltyAccum)) return i;
  }
  return -1;
}

/** 手札の中で一番枚数が多い色を選ぶ（親の権限・ワイルドの色決め用） */
export function pickBestColor(hand: UnoCard[]): string {
  const counts: Record<string, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
  hand.forEach(c => {
    if (c.c !== 'w' && counts[c.c] !== undefined) counts[c.c]!++;
  });
  let best = UNO_COLORS[0]!;
  UNO_COLORS.forEach(c => { if (counts[c]! > counts[best]!) best = c; });
  return best;
}

/**
 * 次の1手を決める（純粋関数）。
 *
 * @param g          ゲーム状態（phase / trumpField / unoDiscardPile /
 *                   unoCurrentColor / unoPenaltyAccum / hasParent など）
 * @param trumpHand  対象プレイヤーのトランプ手札
 * @param unoHand    対象プレイヤーのUNO手札
 * @param playerId   対象プレイヤーID（親の権限判定に使う）
 */
export function decideBotPlan(
  g: any,
  trumpHand: TrumpCard[],
  unoHand: UnoCard[],
  playerId: string
): BotPlan {
  if (!g) return { kind: 'none' };

  // ─── トランプフェイズ ───
  if (g.phase === 'trump') {
    if (trumpHand.length === 0) return { kind: 'trumpSkip' };
    const fieldCards: TrumpCard[] = Array.isArray(g.trumpField) ? g.trumpField : [];
    const playable = findPlayableTrumpSingle(trumpHand, fieldCards, g);
    return playable ? { kind: 'trumpPlay', cardIds: [playable.id] } : { kind: 'trumpPass' };
  }

  // ─── UNOフェイズ ───
  if (g.phase === 'uno') {
    // 親の権限があり、まだUNOが残っているなら先に有利な色へ変更しておく。
    // （出し切り済みの場合は色変更自体がターンを進めてしまうため、下の
    //   0枚スキップに任せる）
    if (g.hasParent === playerId && unoHand.length > 0) {
      return { kind: 'parentColor', color: pickBestColor(unoHand) };
    }

    if (unoHand.length === 0) return { kind: 'unoSkip' };

    const top = g.unoDiscardPile?.[g.unoDiscardPile.length - 1];
    if (!top) return { kind: 'none' };

    const idx = findPlayableUnoIdx(unoHand, top, g.unoCurrentColor, g.unoPenaltyAccum || 0);
    if (idx !== -1) {
      const card = unoHand[idx]!;
      const isWild = card.t === 'w' || card.t === 'w4';
      const color = isWild ? pickBestColor(unoHand.filter((_, i) => i !== idx)) : null;
      // これを出すと残り1枚になる場合は、出す前にUNO宣言しておく
      // （出した「後」だとサーバーが即UNO未宣言ペナルティを確定させてしまう）
      const sayUnoFirst = unoHand.length === 2;
      return { kind: 'unoPlay', idx, color, sayUnoFirst };
    }
    return { kind: 'unoDraw' };
  }

  return { kind: 'none' };
}
