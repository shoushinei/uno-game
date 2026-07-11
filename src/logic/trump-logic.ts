// ========================================
// トランプ（大富豪）ロジック
// ========================================

// -------------------------------------------------------------------------
// ★バグ修正のためのインポート追加★
// game-rules.js から上がり確定処理をインポートします。
// ※実際のプロジェクトのファイル配置（フォルダ階層）に合わせて、パス（'./game-rules'）は適宜調整してください。
// TypeScriptのコンパイルエラーを防ぐため、念のため @ts-ignore を付与しています。
// -------------------------------------------------------------------------
// @ts-ignore
import { finalizeIfBothHandsEmpty } from './game-rules';

// ----------------------------------------
// 型定義
// ----------------------------------------

export type TrumpSuit = '♠' | '♥' | '♦' | '♣';
export type TrumpNum =
  | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A' | '2' | 'JOKER';
export type TrumpValue = TrumpNum; // カードの数値文字列

/** デッキ上の1枚のカード */
export interface TrumpCard {
  s: TrumpSuit | string; // JOKER はジョーカー絵文字スーツ
  v: TrumpValue;
  id: string;
}

/** 場・手の「型」 */
export type PlayType = 'single' | 'set' | 'sequence';

/** 特殊効果の種別 */
export type TrumpEffectType =
  | 'suitLock'
  | 'revolution'
  | 'elevenBack'
  | 'eightCut'
  | 'jokerSingle'
  | 'spadeThree';

/** 出し手・場のカードメタ情報 */
export interface CardMeta {
  type: PlayType;
  length: number;
  /** 代表ランク（set/single: そのランク / sequence: 最高ランク） */
  rank: TrumpValue;
  /** 現在のゲーム状態で評価した強さ */
  power: number;
  /** 関与スーツ一覧（しばり判定用） */
  suits: string[];
  /** 階段の場合のみ: 構成するランク列 */
  values?: TrumpValue[];
  /** スペードの3でジョーカーを返したとき true */
  spadeThreeBreak?: boolean;
}

/** 演出データ */
export interface TrumpEffect {
  type: TrumpEffectType;
  types: TrumpEffectType[];
  playerId: string;
  ts: number;
}

/** このファイルが参照するゲーム状態のサブセット */
export interface TrumpGameState {
  phase: 'trump' | 'uno';
  order: string[];
  ci: number;
  dir: number;
  rankings: Array<{ id: string; name: string }>;

  trumpHands: Record<string, TrumpCard[]>;
  trumpField: TrumpCard[];
  trumpFieldMeta: CardMeta | null;
  /** 現在の場のカードを出したプレイヤー（全員パス時の「親」判定に使う） */
  trumpFieldOwner: string | null;
  trumpSuitLock: string[] | null;
  trumpRevolution: boolean;
  trumpElevenBack: boolean;
  trumpEffect?: TrumpEffect;
  hasParent?: string;

  // UNO 側フィールド（トランプロジックからは直接操作しないが型に含める）
  unoHands?: Record<string, unknown[]>;
}

/**
 * 公開 API で g を省略可能にするための部分型
 * テストや呼び出し側が一部フィールドだけのオブジェクトを渡せるようにする
 */
export type PartialGameState = Partial<TrumpGameState>;

// ----------------------------------------
// 定数
// ----------------------------------------

const TRUMP_SUITS: TrumpSuit[] = ['♠', '♥', '♦', '♣'];
const TRUMP_NUMS: TrumpNum[] = [
  '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2',
];
const TRUMP_STRENGTH: Record<string, number> = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7,
  '10': 8, 'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13, 'JOKER': 14,
};
const TRUMP_INDEX: Record<string, number> = Object.fromEntries(
  TRUMP_NUMS.map((v, i) => [v, i])
);
/** スペードの3 判定用マーク */
const SPADE_SUIT = '\u2660'; // ♠

// ----------------------------------------
// デッキ生成
// ----------------------------------------

/**
 * トランプデッキを生成する
 */
export function buildTrumpDeck(): TrumpCard[] {
  const d: TrumpCard[] = [];
  TRUMP_SUITS.forEach(s =>
    TRUMP_NUMS.forEach(v => d.push({ s, v, id: `${s}${v}` }))
  );
  d.push({ s: '\uD83C\uDCCF', v: 'JOKER', id: 'JOKER' });
  return d;
}

// ----------------------------------------
// 強さ計算
// ----------------------------------------

/**
 * カードの強さを返す（革命・Jバック非考慮の生の強さ）
 */
export function trumpStrength(card: TrumpCard): number {
  return TRUMP_STRENGTH[card.v] ?? 0;
}

/**
 * 現在のゲーム状態で強さが反転しているか判定する
 * 革命 XOR イレブンバック で反転
 */
export function trumpIsReversed(g: PartialGameState = {}): boolean {
  return Boolean(g.trumpRevolution) !== Boolean(g.trumpElevenBack);
}

/**
 * 指定の数値 (value) の現在の強さを返す
 */
export function trumpPowerForValue(
  value: string,
  g: PartialGameState = {}
): number {
  if (value === 'JOKER') return TRUMP_STRENGTH['JOKER']!;
  const normal = TRUMP_STRENGTH[value] ?? 0;
  return trumpIsReversed(g) ? 14 - normal : normal;
}

// ----------------------------------------
// スーツ正規化ヘルパー
// ----------------------------------------

function suitSortValue(suit: string): number {
  const idx = TRUMP_SUITS.indexOf(suit as TrumpSuit);
  return idx === -1 ? TRUMP_SUITS.length : idx;
}

function normalizeSuitGroup(suits: string[]): string[] {
  return [...suits].sort((a, b) => suitSortValue(a) - suitSortValue(b));
}

function suitKey(suits: unknown): string {
  if (!Array.isArray(suits)) return '';
  return normalizeSuitGroup(suits as string[]).join('|');
}

function sameSuitGroup(a: unknown, b: unknown): boolean {
  return suitKey(a) === suitKey(b);
}

// ----------------------------------------
// 場の型解析サブ関数
// ----------------------------------------

/**
 * ジョーカーを「しばり」のスーツに合わせて補完する
 */
function consumeRequiredSuits(
  baseSuits: string[],
  jokerCount: number,
  requiredSuits: string[] | null
): string[] {
  const suits = [...baseSuits];
  if (!Array.isArray(requiredSuits) || requiredSuits.length === 0) {
    return normalizeSuitGroup([...suits, ...Array<string>(jokerCount).fill('JOKER')]);
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

/**
 * 重ね数字（同数字複数枚）の候補を生成する
 */
function buildSetCandidate(
  cards: TrumpCard[],
  g: PartialGameState,
  requiredSuits: string[] | null
): CardMeta | null {
  const nonJokers = cards.filter(c => c.v !== 'JOKER');
  const jokerCount = cards.length - nonJokers.length;
  const value: string = nonJokers[0]?.v ?? 'JOKER';
  if (!nonJokers.every(c => c.v === value)) return null;

  return {
    type: cards.length === 1 ? 'single' : 'set',
    length: cards.length,
    rank: value as TrumpValue,
    power: trumpPowerForValue(value, g),
    suits: consumeRequiredSuits(nonJokers.map(c => c.s), jokerCount, requiredSuits),
  };
}

/**
 * 階段（同スーツ3枚以上連続）の候補を生成する
 * ジョーカーは穴埋めとして使用可能
 */
function buildSequenceCandidates(
  cards: TrumpCard[],
  g: PartialGameState,
  requiredSuits: string[] | null
): CardMeta[] {
  if (cards.length < 3) return [];
  const nonJokers = cards.filter(c => c.v !== 'JOKER');
  const nonJokerSuits = [...new Set(nonJokers.map(c => c.s))];
  // 階段は全て同マーク（ジョーカー除く）
  if (nonJokerSuits.length > 1) return [];

  const usedIndexes = nonJokers.map(c => TRUMP_INDEX[c.v]);
  if (usedIndexes.some(i => i === undefined)) return [];
  // ここ以降 usedIndexes の要素は全て number
  const definedIndexes = usedIndexes as number[];
  if (new Set(definedIndexes).size !== definedIndexes.length) return [];

  const candidates: CardMeta[] = [];
  for (let start = 0; start <= TRUMP_NUMS.length - cards.length; start++) {
    const seqIndexes = Array.from({ length: cards.length }, (_, i) => start + i);
    if (!definedIndexes.every(i => seqIndexes.includes(i))) continue;

    const suit = nonJokerSuits[0] ?? requiredSuits?.[0] ?? 'JOKER';
    const values = seqIndexes.map(i => TRUMP_NUMS[i]).filter((v): v is TrumpNum => v !== undefined);
    if (values.length !== seqIndexes.length) continue; // 念のため
    const topRank = values[values.length - 1];
    if (topRank === undefined) continue;
    candidates.push({
      type: 'sequence',
      length: cards.length,
      rank: topRank,
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
function lockMatches(
  candidate: CardMeta,
  g: PartialGameState
): boolean {
  const lock = g.trumpSuitLock;
  return !Array.isArray(lock) || lock.length === 0 || sameSuitGroup(candidate.suits, lock);
}

/**
 * 場のカードからメタ情報（型・強さ）を取得する
 *
 * ★バグ修正★ イレブンバック・革命で強さが反転した後、キャッシュされた
 * fieldMeta.power が古い値のままになる問題を修正する。
 * キャッシュを使う場合でも power だけは現在のゲーム状態で毎回再計算する。
 */
function getFieldMeta(
  g: PartialGameState,
  fieldCards: TrumpCard[]
): CardMeta | null {
  let meta: CardMeta | null;
  if (g.trumpFieldMeta && g.trumpFieldMeta.length === fieldCards.length) {
    meta = g.trumpFieldMeta;
  } else {
    const setCandidate = buildSetCandidate(fieldCards, g, null);
    meta = setCandidate ?? (buildSequenceCandidates(fieldCards, g, null)[0] ?? null);
  }
  if (!meta) return null;

  // power を現在の強さ反転状態で再計算する
  // (革命・イレブンバック発動後に正しく比較できるようにする)
  if (meta.type === 'sequence') {
    const recalcPower = Math.max(
      ...(meta.values ?? [meta.rank]).map(v => trumpPowerForValue(v, g))
    );
    return { ...meta, power: recalcPower };
  } else {
    return { ...meta, power: trumpPowerForValue(meta.rank, g) };
  }
}

/**
 * ♠3 かどうか判定する
 */
function isSpadeThree(cards: TrumpCard[]): boolean {
  const first = cards[0];
  return cards.length === 1 && first !== undefined && first.s === SPADE_SUIT && first.v === '3';
}

/**
 * 候補の中から場を上回れるものを選ぶ
 */
function chooseCandidate(
  candidates: CardMeta[],
  fieldMeta: CardMeta | null,
  g: PartialGameState
): CardMeta | null {
  const playable = candidates.filter(c => lockMatches(c, g));
  if (!fieldMeta) return playable[0] ?? null;
  return playable.find(c =>
    c.type === fieldMeta.type &&
    c.length === fieldMeta.length &&
    c.power > fieldMeta.power
  ) ?? null;
}

// ----------------------------------------
// 公開 API
// ----------------------------------------

/**
 * 選択したカードが出せる形かどうかを解析し、メタ情報を返す
 * 出せない場合は null を返す
 */
export function analyzeTrumpPlay(
  selectedCards: TrumpCard[],
  g: PartialGameState = {},
  fieldCards: TrumpCard[] = g.trumpField ?? []
): CardMeta | null {
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

  const requiredSuits =
    Array.isArray(g.trumpSuitLock) && g.trumpSuitLock.length > 0
      ? g.trumpSuitLock
      : null;
  const candidates: CardMeta[] = [];
  const setCandidate = buildSetCandidate(selectedCards, g, requiredSuits);
  if (setCandidate) candidates.push(setCandidate);
  candidates.push(...buildSequenceCandidates(selectedCards, g, requiredSuits));

  return chooseCandidate(candidates, fieldMeta, g);
}

/**
 * 選択したカードが出せるかどうかを返す（true/false）
 */
export function trumpCanPlay(
  selectedCards: TrumpCard[],
  fieldCards: TrumpCard[],
  g: PartialGameState = {}
): boolean {
  return Boolean(analyzeTrumpPlay(selectedCards, g, fieldCards));
}

/**
 * 手札をランク昇順にソートして返す（非破壊的）
 */
export function sortTrumpHand(hand: TrumpCard[]): TrumpCard[] {
  return [...hand].sort((a, b) => trumpStrength(a) - trumpStrength(b));
}

/** applyTrumpPlay の戻り値 */
export interface TrumpPlayResult {
  g: TrumpGameState;
  logMsg: string;
  isGameOver?: boolean;
}

/**
 * トランプカードを出す処理
 *
 * 処理の流れ：
 * 1. 手札から選択カードを取り出す
 * 2. analyzeTrumpPlay で出せるか確認
 * 3. 特殊効果（8切り・革命・Jバック・しばり・スペ3）を適用
 * 4. phase を進める
 * - 通常時：UNOフェイズへ進む（従来通り）
 * - 8切り／ジョーカー単体／スペ3で場を流した場合：★バグ修正★
 * トランプフェイズに留まり、場を流した本人がもう一度トランプを
 * 出せるようにする（UNOフェイズへは進めない）。
 */
export function applyTrumpPlay(
  g: TrumpGameState,
  playerId: string,
  cardIds: string[],
  playerName: string
): TrumpPlayResult | null {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  // ★予防的修正（uno-logic.js の applyUnoPlay と同じFirebase空配列対策）★
  // g.trumpHands 自体が undefined（=全員トランプ完了済み）の場合に備えてガードする。
  const hand = [...((g.trumpHands && g.trumpHands[playerId]) ?? [])];
  const selectedCards: TrumpCard[] = [];
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
  // ★バグ修正★ 場を作った人を常に記録する。
  // 「全員パス」で場が流れたときに正しい「親」を判定するために使う。
  g.trumpFieldOwner = playerId;

  // -------------------------------------------------------------------------
  // ★バグ修正：両手札が0枚になった瞬間の上がり判定を追加（エラー修正版）★
  // 引数に playerName を追加し、戻り値オブジェクトの .finished を確認します。
  // -------------------------------------------------------------------------
  if (typeof finalizeIfBothHandsEmpty === 'function') {
    const finishResult = finalizeIfBothHandsEmpty(g, playerId, playerName);
    if (finishResult && finishResult.finished) {
      const cardNames = selectedCards.map(c => `${c.s}${c.v}`).join(',');
      // game-rules.js側で構築されたログ（〇〇が上がりました等）があれば優先し、無ければフォールバックメッセージを使用
      const log = finishResult.logMsg || `${playerName}がトランプ[${cardNames}]を出し切り、見事上がりました！`;
      return {
        g,
        logMsg: log,
        isGameOver: finishResult.isGameOver,
      };
    }
  }

  // ---- 特殊効果の判定 ----
  const effects: TrumpEffectType[] = [];

  // しばり：前の場と同型・同スーツが連続した場合に発動
  const createsSuitLock =
    previousMeta !== null &&
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
  const clearsField = has8Cut || isJokerSingle || Boolean(playMeta.spadeThreeBreak);
  if (clearsField) {
    g.trumpField = [];
    g.trumpFieldMeta = null;
    g.trumpFieldOwner = null;
    g.trumpSuitLock = null;
    g.trumpElevenBack = false;
    g.hasParent = playerId;
  }

  // 演出データを保存
  const lastEffect = effects[effects.length - 1];
  if (effects.length > 0 && lastEffect !== undefined) {
    g.trumpEffect = {
      type: lastEffect,
      types: effects,
      playerId,
      ts: Date.now(),
    };
  }

  // ログメッセージ生成
  const effectLabels: Record<TrumpEffectType, string> = {
    suitLock:    'しばり',
    revolution:  g.trumpRevolution ? '🌀 革命！' : '🌀 革命返し！',
    elevenBack:  '🔄 イレブンバック！',
    eightCut:    '✂️ 8切り！',
    jokerSingle: '🃏 ジョーカー！',
    spadeThree:  '♠3 ジョーカー返し！',
  };
  const effectText = effects.map(e => effectLabels[e]).join(' / ');

  // ★バグ修正★
  // 以前はここで無条件に g.phase = 'uno' としていたため、8切り・ジョーカー単体・
  // スペ3で場を流した直後に「場を流した本人がもう一度トランプを出す」フェーズが
  // 丸ごとスキップされ、次のプレイヤーがいきなり空の場に何でも出せてしまっていた。
  //
  // 場を流した場合（clearsField === true）は phase を 'trump' のまま維持し、
  // ci も変更しない（＝まだ同じプレイヤーの手番）ことで、出した本人がもう一度
  // トランプを出せるようにする。本人の手札が0枚の場合は actionTrumpSkip 経由で
  // applyTrumpSkip が呼ばれ、そちらで正しくUNOフェイズへ進む（または両手札0枚なら
  // 上がり確定する）。
  //
  // 通常の場合（場を流していない）は従来通り、そのままUNOフェイズへ進む。
  g.phase = clearsField ? 'trump' : 'uno';

  const cardNames = selectedCards.map(c => `${c.s}${c.v}`).join(',');
  return {
    g,
    logMsg: `${playerName}がトランプ[${cardNames}]を出した${effectText ? ' ' + effectText : ''}`,
  };
}

/** applyTrumpPass の戻り値 */
export interface TrumpPassResult {
  g: TrumpGameState;
  logMsg: string;
}

/**
 * トランプをパスする処理（破壊的）
 * パス後は UNO フェイズに進む
 */
export function applyTrumpPass(
  g: TrumpGameState,
  playerId: string,
  playerName: string
): TrumpPassResult {
  g.phase = 'uno';
  return { g, logMsg: `${playerName}がトランプをパス` };
}
