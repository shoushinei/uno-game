// ========================================
// ゲーム初期化・ターン制御
// ========================================
import { buildUnoDeck, drawUnoCards } from './uno-logic.js';
import { buildTrumpDeck, sortTrumpHand, type TrumpCard } from './trump-logic.js';
import type { Player, GameState, UnoCard } from './types';

export const AVATAR_COLORS: string[] = ['#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];

/**
 * 配列をシャッフルして返す（非破壊的）
 */
export function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * 次のプレイヤーのインデックスを計算する
 */
export function nextPlayerIndex(ci: number, dir: number, n: number): number {
  return (ci + dir + n) % n;
}

/**
 * 融合ゲームの初期状態を生成する
 */
export function initFusionGame(players: Player[]): GameState {
  const trumpDeck = shuffle(buildTrumpDeck());
  const unoDeck = shuffle(buildUnoDeck());

  // トランプを全員に均等配布
  const trumpHands: Record<string, TrumpCard[]> = {};
  const unoHands: Record<string, UnoCard[]> = {};
  players.forEach(p => { trumpHands[p.id] = []; unoHands[p.id] = []; });

  let di = 0;
  while (di < trumpDeck.length) {
    players.forEach(p => { if (di < trumpDeck.length) trumpHands[p.id].push(trumpDeck[di++]); });
  }
  players.forEach(p => { trumpHands[p.id] = sortTrumpHand(trumpHands[p.id]); });

  // UNOは7枚ずつ配布
  const unoPerPlayer = 7;
  players.forEach((p, i) => {
    unoHands[p.id] = unoDeck.slice(i * unoPerPlayer, (i + 1) * unoPerPlayer);
  });
  const unoDrawPile = unoDeck.slice(unoPerPlayer * players.length);

  // 山札の先頭をフィールドカードにする（ワイルドは除く）
  let unoFieldCard: UnoCard | undefined;
  const remaining = [...unoDrawPile];
  const extraDiscard: UnoCard[] = [];
  while (remaining.length > 0) {
    const card = remaining.pop();
    if (!card) break;
    if (card.t !== 'w' && card.t !== 'w4') { unoFieldCard = card; break; }
    extraDiscard.push(card);
  }
  const finalDrawPile = [...remaining, ...extraDiscard];

  // ♦3を持つプレイヤーが先手
  const order = players.map(p => p.id);
  const d3holder = players.find(p => trumpHands[p.id].some(c => c.s === '♦' && c.v === '3'));
  const startCI = d3holder ? order.indexOf(d3holder.id) : 0;

  return {
    order,
    ci: startCI,
    dir: 1,
    phase: 'trump',
    rankings: [],
    trumpHands,
    trumpField: [],
    trumpFieldMeta: null,
    // ★バグ修正で追加★ 場を作ったプレイヤーを記録する。
    // 全員パスで場が流れた際の「親」判定（checkAllPassed）に使う。
    trumpFieldOwner: null,
    trumpRevolution: false,
    trumpElevenBack: false,
    trumpSuitLock: null,
    trumpEffect: null,
    hasParent: null,
    unoHands,
    unoDrawPile: finalDrawPile,
    unoDiscardPile: unoFieldCard ? [unoFieldCard] : [],
    unoCurrentColor: unoFieldCard ? unoFieldCard.c : 'red',
    unoPenaltyAccum: 0,
    unoSaid: {},
  };
}
