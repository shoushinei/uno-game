// ========================================
// ゲーム初期化・ターン制御
// ========================================
import { buildUnoDeck, drawUnoCards } from './uno-logic.js';
import { buildTrumpDeck, sortTrumpHand } from './trump-logic.js';

export const AVATAR_COLORS = ['#e74c3c', '#2980b9', '#27ae60', '#f39c12', '#8e44ad'];

/**
 * 配列をシャッフルして返す（非破壊的）
 */
export function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 次のプレイヤーのインデックスを計算する
 */
export function nextPlayerIndex(ci, dir, n) {
  return (ci + dir + n) % n;
}

/**
 * 融合ゲームの初期状態を生成する
 * @param {{ id: string, name: string }[]} players
 * @returns {object} ゲーム状態
 */
export function initFusionGame(players) {
  const trumpDeck = shuffle(buildTrumpDeck());
  const unoDeck = shuffle(buildUnoDeck());

  // トランプを全員に均等配布
  const trumpHands = {};
  const unoHands = {};
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
  let unoFieldCard;
  const remaining = [...unoDrawPile];
  const extraDiscard = [];
  while (remaining.length > 0) {
    const card = remaining.pop();
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
    hasParent: null,
    unoHands,
    unoDrawPile: finalDrawPile,
    unoDiscardPile: unoFieldCard ? [unoFieldCard] : [],
    unoCurrentColor: unoFieldCard ? unoFieldCard.c : 'red',
    unoPenaltyAccum: 0,
    unoSaid: {},
  };
}
