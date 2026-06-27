// ========================================
// トランプ（大富豪）ロジック
// ========================================

const TRUMP_SUITS = ['♠', '♥', '♦', '♣'];
const TRUMP_NUMS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const TRUMP_STRENGTH = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
  '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13, 'JOKER': 14,
};

/**
 * トランプデッキを生成する
 */
export function buildTrumpDeck() {
  const d = [];
  TRUMP_SUITS.forEach(s => TRUMP_NUMS.forEach(v => d.push({ s, v, id: `${s}${v}` })));
  d.push({ s: '🃏', v: 'JOKER', id: 'JOKER' });
  return d;
}

/**
 * カードの強さを返す
 */
export function trumpStrength(card) {
  return TRUMP_STRENGTH[card.v] ?? 0;
}

/**
 * 複数枚出し判定
 * @param {object[]} selectedCards - 出したいカードの配列
 * @param {object[]} fieldCards - 現在の場のカード配列（空配列 = 場が空）
 * @returns {boolean}
 */
export function trumpCanPlay(selectedCards, fieldCards) {
  if (!Array.isArray(selectedCards) || selectedCards.length === 0) return false;

  const nonJokerCards = selectedCards.filter(c => c.v !== 'JOKER');
  let targetValue = 'JOKER';
  if (nonJokerCards.length > 0) {
    targetValue = nonJokerCards[0].v;
    // 同一数字のみ複数枚出しを許可
    if (!nonJokerCards.every(c => c.v === targetValue)) return false;
  }

  const selectedPower = TRUMP_STRENGTH[targetValue] ?? 0;
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];

  // 場が空なら何でも出せる
  if (fCards.length === 0) return true;

  // 場にカードがある場合、枚数一致 AND 強さが上回る必要がある
  if (selectedCards.length !== fCards.length) return false;

  const nonJokerField = fCards.filter(c => c.v !== 'JOKER');
  const fieldValue = nonJokerField.length > 0 ? nonJokerField[0].v : 'JOKER';
  const fieldPower = TRUMP_STRENGTH[fieldValue] ?? 0;

  return selectedPower > fieldPower;
}

/**
 * 手札をランク昇順にソートして返す
 */
export function sortTrumpHand(hand) {
  return [...hand].sort((a, b) => trumpStrength(a) - trumpStrength(b));
}

/**
 * トランプカードを出す処理（破壊的）
 * @returns {{ g, logMsg: string } | null}
 */
export function applyTrumpPlay(g, playerId, cardIds, playerName) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const hand = [...(g.trumpHands[playerId] || [])];
  const selectedCards = [];

  for (const id of cardIds) {
    const card = hand.find(c => c.id === id);
    if (!card) return null;
    selectedCards.push(card);
  }

  if (!trumpCanPlay(selectedCards, g.trumpField)) return null;

  g.trumpHands[playerId] = hand.filter(c => !cardIds.includes(c.id));
  g.trumpField = selectedCards;

  let extra = '';
  const hasJokerSingle = selectedCards.length === 1 && selectedCards[0].v === 'JOKER';
  const has8 = selectedCards.some(c => c.v === '8');

  if (hasJokerSingle) {
    g.trumpField = [];
    g.hasParent = playerId;
    extra = 'ジョーカー！場が流れた 👑親になった';
  } else if (has8) {
    g.trumpField = [];
    g.hasParent = playerId;
    extra = '8切り！場が流れた 👑親になった';
  }

  g.phase = 'uno';
  const cardNames = selectedCards.map(c => `${c.s}${c.v}`).join(',');
  return {
    g,
    logMsg: `${playerName}がトランプ[${cardNames}]を出した${extra ? ' ' + extra : ''}`,
  };
}

/**
 * トランプをパスする処理（破壊的）
 */
export function applyTrumpPass(g, playerId, playerName) {
  g.phase = 'uno';
  return { g, logMsg: `${playerName}がトランプをパス` };
}
