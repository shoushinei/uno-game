// ========================================
// 実績判定の純粋ロジック（Phase 3）
//
// Cloud Functions 本体（index.ts）から使う。actionLog（操作履歴）と
// 戦績（stats）から「このゲームで解除された実績ID」を導出する。
// Firebase 非依存の純粋関数として分離し、ルートの vitest でテストする。
//
// 実績IDはフロント（src/achievements.ts）の表示メタ情報と一致させる契約。
// 判定はサーバー側で行うため、クライアントからの改ざんはできない
// （actionLog自体の偽装＝ゲーム進行全体の偽装は、合意済みの許容ライン）。
// ★例外★ 'reaction-first'（対人リアクション初送信）だけはクライアント記録。
// ========================================

/** actionLog の1エントリ（functions側で使う最小形） */
export interface LogEntry {
  type: string;
  playerId: string;
  args: { cardIds?: string[]; [k: string]: unknown };
  ts?: number;
}

/** initialState.trumpHands から作る「カードID → 札」の対応表 */
export type CardById = Record<string, { s: string; v: string }>;

// トランプの強さ順（階段＝連番の判定に使う）。JOKERは連番に含めない
const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

/** 出した札が「階段（同スート3枚以上の連番）」か */
function isSequence(cards: { s: string; v: string }[]): boolean {
  if (cards.length < 3) return false;
  if (!cards.every(c => c.s === cards[0]!.s)) return false;
  const idxs = cards.map(c => RANK_ORDER.indexOf(c.v)).sort((a, b) => a - b);
  if (idxs.some(i => i < 0)) return false; // JOKER等が混じる＝連番でない
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] !== idxs[i - 1]! + 1) return false;
  }
  return true;
}

/** そのトランプ出しが「8切り」か（8を含み、かつ階段でない） */
function isEightCutPlay(cardIds: string[], cardById: CardById): boolean {
  const cards = cardIds.map(id => cardById[id]).filter((c): c is { s: string; v: string } => !!c);
  if (!cards.some(c => c.v === '8')) return false;
  return !isSequence(cards);
}

/**
 * 1プレイヤーの、このゲーム内の実績関連シグナルを actionLog から抽出する。
 * - sayUnoCount: このゲームでのUNO宣言回数
 * - revolution : 4枚以上出し（革命）をしたか
 * - eightCut   : 8切りで出したか
 * - doubleFinish: 同一ターンでトランプとUNOを両方出し切って上がったか
 *   （上がっている＝finished 前提。最後の trumpPlay と最後の unoPlay が
 *    同一手番＝間に他プレイヤーの操作が挟まっていない、で判定）
 */
export function analyzePlayerActions(
  actionLog: LogEntry[],
  uid: string,
  cardById: CardById,
  finished: boolean
): { sayUnoCount: number; revolution: boolean; eightCut: boolean; doubleFinish: boolean } {
  let sayUnoCount = 0;
  let revolution = false;
  let eightCut = false;
  let lastTrumpPlayIdx = -1;
  let lastUnoPlayIdx = -1;

  actionLog.forEach((e, i) => {
    if (e.playerId !== uid) return;
    if (e.type === 'sayUno') sayUnoCount++;
    else if (e.type === 'trumpPlay') {
      const ids = Array.isArray(e.args?.cardIds) ? e.args.cardIds : [];
      if (ids.length >= 4) revolution = true;
      if (isEightCutPlay(ids, cardById)) eightCut = true;
      lastTrumpPlayIdx = i;
    } else if (e.type === 'unoPlay') {
      lastUnoPlayIdx = i;
    }
  });

  let doubleFinish = false;
  if (finished && lastTrumpPlayIdx !== -1 && lastUnoPlayIdx !== -1 && lastTrumpPlayIdx < lastUnoPlayIdx) {
    // 最後のトランプ出しと最後のUNO出しの間に、他プレイヤーの操作が無いか
    // （＝同じ手番のうちに両方出し切った）
    let sameTurn = true;
    for (let i = lastTrumpPlayIdx + 1; i < lastUnoPlayIdx; i++) {
      if (actionLog[i]!.playerId !== uid) { sameTurn = false; break; }
    }
    doubleFinish = sameTurn;
  }

  return { sayUnoCount, revolution, eightCut, doubleFinish };
}

/** initialState.trumpHands から cardById を作る（全プレイヤーの初期札を統合） */
export function buildCardById(trumpHands: Record<string, { s: string; v: string; id: string }[]> | null | undefined): CardById {
  const map: CardById = {};
  for (const hand of Object.values(trumpHands ?? {})) {
    for (const c of hand ?? []) {
      if (c && typeof c.id === 'string') map[c.id] = { s: c.s, v: c.v };
    }
  }
  return map;
}

export interface EvaluateInput {
  statsBefore: { wins?: number } | null;
  statsAfter: { games: number; winStreak: number; loseStreak: number };
  rank: number;
  /** このゲーム反映後の累計UNO宣言数 */
  sayUnoCumulative: number;
  actions: { revolution: boolean; eightCut: boolean; doubleFinish: boolean };
}

/**
 * このゲームで「条件を満たしている」実績IDの一覧を返す（純粋関数）。
 * 既に解除済みかどうかは考慮しない（呼び出し側が新規分だけを記録する）。
 */
export function evaluateAchievements(input: EvaluateInput): string[] {
  const out: string[] = [];
  const beforeWins = input.statsBefore?.wins ?? 0;

  if (input.statsAfter.games >= 1) out.push('first-game');
  if (input.rank === 1 && beforeWins === 0) out.push('first-win');
  if (input.statsAfter.games >= 10) out.push('games-10');
  if (input.statsAfter.winStreak >= 3) out.push('streak-win-3');
  if (input.statsAfter.loseStreak >= 3) out.push('streak-lose-3');
  if (input.sayUnoCumulative >= 5) out.push('uno-declare-5');
  if (input.actions.revolution) out.push('revolution');
  if (input.actions.eightCut) out.push('eight-cut');
  if (input.actions.doubleFinish) out.push('double-finish');

  return out;
}
