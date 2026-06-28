// ========================================
// トランプ（大富豪）ロジック
// ========================================

const TRUMP_SUITS = ['♠', '♥', '♦', '♣'];
const TRUMP_NUMS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const TRUMP_STRENGTH = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
  '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13, 'JOKER': 14,
};
const TRUMP_INDEX = Object.fromEntries(TRUMP_NUMS.map((v, i) => [v, i]));
// スペードの3 用：スペードマークそのもの
const SPADE_SUIT = '\u2660'; // ♠

/**
 * トランプデッキを生成する
 */
export function buildTrumpDeck() {
  const d = [];
  TRUMP_SUITS.forEach(s => TRUMP_NUMS.forEach(v => d.push({ s, v, id: `${s}${v}` })));
  d.push({ s: '\uD83C\uDCCF', v: 'JOKER', id: 'JOKER' });
  return d;
}

/**
 * カードの強さを返す（革命・Jバック非考慮の生の強さ）
 */
export function trumpStrength(card) {
  return TRUMP_STRENGTH[card.v] ?? 0;
}

/**
 * 現在のゲーム状態で強さが反転しているか判定する
 * 革命 XOR イレブンバック で反転
 */
export function trumpIsReversed(g = {}) {
  return Boolean(g.trumpRevolution) !== Boolean(g.trumpElevenBack);
}

/**
 * 指定の数値 (value) の現在の強さを返す
 */
export function trumpPowerForValue(value, g = {}) {
  if (value === 'JOKER') return TRUMP_STRENGTH.JOKER;
  const normal = TRUMP_STRENGTH[value] ?? 0;
  return trumpIsReversed(g) ? 14 - normal : normal;
}

// ---- スーツ正規化ヘルパー ----
function suitSortValue(suit) {
  const idx = TRUMP_SUITS.indexOf(suit);
  return idx === -1 ? TRUMP_SUITS.length : idx;
}

function normalizeSuitGroup(suits) {
  return [...suits].sort((a, b) => suitSortValue(a) - suitSortValue(b));
}

function suitKey(suits = []) {
  return normalizeSuitGroup(suits).join('|');
}

function sameSuitGroup(a = [], b = []) {
  return suitKey(a) === suitKey(b);
}

/**
 * ジョーカーを「しばり」のスーツに合わせて補完する
 */
function consumeRequiredSuits(baseSuits, jokerCount, requiredSuits) {
  const suits = [...baseSuits];
  if (!Array.isArray(requiredSuits) || requiredSuits.length === 0) {
    return normalizeSuitGroup([...suits, ...Array(jokerCount).fill('JOKER')]);
  }
  const remaining = [...requiredSuits];
  for (const suit of baseSuits) {
    const idx = remaining.indexOf(suit);
    if (idx !== -1) remaining.splice(idx, 1);
  }
  for (let i = 0; i < jokerCount; i++) {
    suits.push(remaining[i] ?? requiredSuits[0] ?? 'JOKER');
  }
  return normalizeSuitGroup(suits);
}

// ---- 場の型を解析するサブ関数 ----

/**
 * 重ね数字（同数字複数枚）の候補を生成する
 */
function buildSetCandidate(cards, g, requiredSuits) {
  const nonJokers = cards.filter(c => c.v !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  const value = nonJokers[0]?.v ?? 'JOKER';
  if (!nonJokers.every(c => c.v === value)) return null;

  return {
    type: cards.length === 1 ? 'single' : 'set',
    length: cards.length,
    rank: value,
    power: trumpPowerForValue(value, g),
    suits: consumeRequiredSuits(nonJokers.map(c => c.s), jokerCount, requiredSuits),
  };
}

/**
 * 階段（同スーツ3枚以上連続）の候補を生成する
 * ジョーカーは穴埋めとして使用可能
 */
function buildSequenceCandidates(cards, g, requiredSuits) {
  if (cards.length < 3) return [];
  const nonJokers = cards.filter(c => c.v !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  const nonJokerSuits = [...new Set(nonJokers.map(c => c.s))];
  // 階段は全て同マーク（ジョーカー除く）
  if (nonJokerSuits.length > 1) return [];

  const usedIndexes = nonJokers.map(c => TRUMP_INDEX[c.v]);
  if (usedIndexes.some(i => i === undefined)) return [];
  if (new Set(usedIndexes).size !== usedIndexes.length) return [];

  const candidates = [];
  // ジョーカーで埋められる場所を全探索
  for (let start = 0; start <= TRUMP_NUMS.length - cards.length; start++) {
    const seqIndexes = Array.from({ length: cards.length }, (_, i) => start + i);
    if (!usedIndexes.every(i => seqIndexes.includes(i))) continue;

    const suit = nonJokerSuits[0] ?? requiredSuits?.[0] ?? 'JOKER';
    const values = seqIndexes.map(i => TRUMP_NUMS[i]);
    candidates.push({
      type: 'sequence',
      length: cards.length,
      rank: values[values.length - 1],
      values,
      power: Math.max(...values.map(v => trumpPowerForValue(v, g))),
      suits: [suit],
    });
  }
  return candidates;
}

/**
 * しばり中の場合、スーツが一致するか確認する
 */
function lockMatches(candidate, g = {}) {
  const lock = g.trumpSuitLock;
  return !Array.isArray(lock) || lock.length === 0 || sameSuitGroup(candidate.suits, lock);
}

/**
 * 場のカードからメタ情報（型・強さ）を取得する
 */
function getFieldMeta(g = {}, fieldCards = []) {
  // 場のメタが既にある場合はそれを使う
  if (g.trumpFieldMeta && g.trumpFieldMeta.length === fieldCards.length) {
    return g.trumpFieldMeta;
  }
  const setCandidate = buildSetCandidate(fieldCards, g, null);
  if (setCandidate) return setCandidate;
  return buildSequenceCandidates(fieldCards, g, null)[0] ?? null;
}

/**
 * ♠3 かどうか判定する
 */
function isSpadeThree(cards) {
  return cards.length === 1 && cards[0].s === SPADE_SUIT && cards[0].v === '3';
}

/**
 * 候補の中から場を上回れるものを選ぶ
 */
function chooseCandidate(candidates, fieldMeta, g) {
  const playable = candidates.filter(c => lockMatches(c, g));
  if (!fieldMeta) return playable[0] ?? null;
  return playable.find(c =>
    c.type === fieldMeta.type &&
    c.length === fieldMeta.length &&
    c.power > fieldMeta.power
  ) ?? null;
}

/**
 * 選択したカードが出せる形かどうかを解析し、メタ情報を返す
 * 出せない場合は null を返す
 */
export function analyzeTrumpPlay(selectedCards, g = {}, fieldCards = g.trumpField) {
  if (!Array.isArray(selectedCards) || selectedCards.length === 0) return null;
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];
  const fieldMeta = fCards.length > 0 ? getFieldMeta(g, fCards) : null;

  // スペードの3 → ジョーカー1枚を返す特殊処理
  if (fieldMeta?.type === 'single' && fieldMeta.rank === 'JOKER' && isSpadeThree(selectedCards)) {
    return {
      type: 'single',
      length: 1,
      rank: '3',
      power: trumpPowerForValue('JOKER', g) + 1,
      suits: [SPADE_SUIT],
      spadeThreeBreak: true,
    };
  }

  // 場にカードがある場合は枚数を一致させる必要がある
  if (fCards.length > 0 && selectedCards.length !== fCards.length) return null;

  const requiredSuits = Array.isArray(g.trumpSuitLock) && g.trumpSuitLock.length > 0
    ? g.trumpSuitLock
    : null;
  const candidates = [];
  const setCandidate = buildSetCandidate(selectedCards, g, requiredSuits);
  if (setCandidate) candidates.push(setCandidate);
  candidates.push(...buildSequenceCandidates(selectedCards, g, requiredSuits));

  return chooseCandidate(candidates, fieldMeta, g);
}

/**
 * 選択したカードが出せるかどうかを返す（true/false）
 */
export function trumpCanPlay(selectedCards, fieldCards, g = {}) {
  return Boolean(analyzeTrumpPlay(selectedCards, g, fieldCards));
}

/**
 * 手札をランク昇順にソートして返す（非破壊的）
 */
export function sortTrumpHand(hand) {
  return [...hand].sort((a, b) => trumpStrength(a) - trumpStrength(b));
}

/**
 * トランプカードを出す処理
 *
 * 処理の流れ：
 *  1. 手札から選択カードを取り出す
 *  2. analyzeTrumpPlay で出せるか確認
 *  3. 特殊効果（8切り・革命・Jバック・しばり・スペ3）を適用
 *  4. phase を 'uno' に進める
 *
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

  const fieldCards = Array.isArray(g.trumpField) ? g.trumpField : [];
  const previousMeta = fieldCards.length > 0 ? getFieldMeta(g, fieldCards) : null;
  const playMeta = analyzeTrumpPlay(selectedCards, g, fieldCards);
  if (!playMeta) return null;

  // 手札からカードを除く
  g.trumpHands[playerId] = hand.filter(c => !cardIds.includes(c.id));
  // 場を更新
  g.trumpField = selectedCards;
  g.trumpFieldMeta = playMeta;

  // ---- 特殊効果の判定 ----
  const effects = [];

  // しばり：前の場と同型・同スーツが連続した場合に発動
  const createsSuitLock = previousMeta &&
    previousMeta.type === playMeta.type &&
    previousMeta.length === playMeta.length &&
    sameSuitGroup(previousMeta.suits, playMeta.suits) &&
    !sameSuitGroup(g.trumpSuitLock, playMeta.suits);
  if (createsSuitLock) {
    g.trumpSuitLock = playMeta.suits;
    effects.push('suitLock');
  }

  // 革命：4枚以上同時出し（階段でも可）
  if (selectedCards.length >= 4) {
    g.trumpRevolution = !g.trumpRevolution;
    effects.push('revolution');
  }

  // イレブンバック：Jを含む（階段でない場合のみ）
  const hasElevenBack = playMeta.type !== 'sequence' && selectedCards.some(c => c.v === 'J');
  if (hasElevenBack) {
    g.trumpElevenBack = true;
    effects.push('elevenBack');
  }

  // 8切り：8を含む（階段でない場合のみ）
  const has8Cut = playMeta.type !== 'sequence' && selectedCards.some(c => c.v === '8');
  if (has8Cut) effects.push('eightCut');

  // ジョーカー単体出し：最強カードとして場が流れ、出したプレイヤーが親になる
  const isJokerSingle = playMeta.type === 'single' && playMeta.rank === 'JOKER';
  if (isJokerSingle) effects.push('jokerSingle');

  // スペードの3でジョーカーを返す
  if (playMeta.spadeThreeBreak) effects.push('spadeThree');

  // ---- 場流し処理 ----
  // 8切り・ジョーカー単体・スペ3は即座に場を流し、出したプレイヤーが「親」になる
  if (has8Cut || isJokerSingle || playMeta.spadeThreeBreak) {
    g.trumpField = [];
    g.trumpFieldMeta = null;
    g.trumpSuitLock = null;
    g.trumpElevenBack = false;
    g.hasParent = playerId;
  }

  // 演出データを保存
  if (effects.length > 0) {
    g.trumpEffect = {
      type: effects[effects.length - 1],
      types: effects,
      playerId,
      ts: Date.now(),
    };
  }

  // ログメッセージ生成
  const effectLabels = {
    suitLock: 'しばり',
    revolution: g.trumpRevolution ? '🌀 革命！' : '🌀 革命返し！',
    elevenBack: '🔄 イレブンバック！',
    eightCut: '✂️ 8切り！',
    jokerSingle: '🃏 ジョーカー！',
    spadeThree: '♠3 ジョーカー返し！',
  };
  const effectText = effects.map(e => effectLabels[e]).filter(Boolean).join(' / ');

  g.phase = 'uno';
  const cardNames = selectedCards.map(c => `${c.s}${c.v}`).join(',');
  return {
    g,
    logMsg: `${playerName}がトランプ[${cardNames}]を出した${effectText ? ' ' + effectText : ''}`,
  };
}

/**
 * トランプをパスする処理（破壊的）
 * パス後は UNO フェイズに進む
 */
export function applyTrumpPass(g, playerId, playerName) {
  g.phase = 'uno';
  return { g, logMsg: `${playerName}がトランプをパス` };
}
