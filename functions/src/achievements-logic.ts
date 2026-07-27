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

/**
 * 「手番の切れ目」を示す行動の種類。
 * これが挟まっていたら、前後は別の手番だと判断できる。
 *  - trumpPlay/trumpPass/trumpSkip … 新しいトランプフェイズが始まった
 *  - unoDraw/unoSkip               … その手番のUNOフェイズが出さずに終わった
 * （sayUno / pickParentColor / yachtDuel は同じ手番の中で起こるので含めない）
 */
const TURN_BOUNDARY_TYPES = new Set([
  'trumpPlay', 'trumpPass', 'trumpSkip', 'unoDraw', 'unoSkip',
]);

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

/** カードIDの並びを実体に解決する（未知IDは落とす） */
function resolve(cardIds: unknown, cardById: CardById): { s: string; v: string }[] {
  const ids = Array.isArray(cardIds) ? cardIds : [];
  return ids.map((id: string) => cardById[id]).filter((c): c is { s: string; v: string } => !!c);
}

/** 単騎のジョーカー出しか */
function isJokerSingle(cards: { s: string; v: string }[]): boolean {
  return cards.length === 1 && cards[0]!.v === 'JOKER';
}

/** 単騎の♠3出しか */
function isSpadeThreeSingle(cards: { s: string; v: string }[]): boolean {
  return cards.length === 1 && cards[0]!.s === '♠' && cards[0]!.v === '3';
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
export interface PlayerActions {
  sayUnoCount: number;
  revolution: boolean;
  eightCut: boolean;
  doubleFinish: boolean;
  // ---- ★M4で追加★ ----
  /** 階段（同スート3枚以上の連番）を出した */
  stairs: boolean;
  /** ジョーカー単騎で場を流した */
  jokerSingle: boolean;
  /** 直前のジョーカー単騎を♠3で返した */
  spadeThree: boolean;
  /** 直前のプレイヤーの +2/+4 に +2/+4 を重ねて返した */
  drawStack: boolean;
  /** このゲームでヨット対決を自分から挑んだ */
  yachtChallenged: boolean;
  /** このゲームで出したヨット対決の最高役が「ヨット」(5個同じ目)だった */
  yachtBest: boolean;
  /** このゲームでのヨット対決の勝利数 */
  yachtWins: number;
  /** このゲームで親の権限を使った回数 */
  parentColorCount: number;
}

export function analyzePlayerActions(
  actionLog: LogEntry[],
  uid: string,
  cardById: CardById,
  finished: boolean
): PlayerActions {
  let sayUnoCount = 0;
  let revolution = false;
  let eightCut = false;
  let stairs = false;
  let jokerSingle = false;
  let spadeThree = false;
  let drawStack = false;
  let yachtChallenged = false;
  let yachtBest = false;
  let yachtWins = 0;
  let parentColorCount = 0;
  let lastTrumpPlayIdx = -1;
  let lastUnoPlayIdx = -1;

  // 直前の状況を覚えておく（「返した」系の判定に使う）。
  // 場の状態を復元せずに済むよう、actionLog の並びだけで判断する。
  let prevTrumpPlay: { by: string; cards: { s: string; v: string }[] } | null = null;
  let prevUnoDraw2: { by: string } | null = null;

  actionLog.forEach((e, i) => {
    // ---- 全員ぶんを見る必要があるもの（自分が defender 側になりうる） ----
    if (e.type === 'yachtDuel') {
      const a: any = e.args ?? {};
      if (a.attackerId === uid) yachtChallenged = true;
      const isParty = a.attackerId === uid || a.defenderId === uid;
      if (isParty) {
        const mine = a.attackerId === uid ? a.attackerBest : a.defenderBest;
        if (mine && mine.category === 'yacht' && (mine.score ?? 0) > 0) yachtBest = true;
        // result は 'attacker' | 'defender' | 'draw'
        const winnerId = a.result === 'attacker' ? a.attackerId
          : a.result === 'defender' ? a.defenderId : null;
        if (winnerId === uid) yachtWins++;
      }
    }

    // ---- 「直前の手を返した」判定のため、他人の手も記録しておく ----
    const cards = e.type === 'trumpPlay' ? resolve(e.args?.cardIds, cardById) : [];
    const unoT = e.type === 'unoPlay' ? (e.args as any)?.card?.t : undefined;
    const isDraw2 = unoT === 'd2' || unoT === 'w4';

    if (e.playerId === uid) {
      if (e.type === 'sayUno') sayUnoCount++;
      else if (e.type === 'pickParentColor') parentColorCount++;
      else if (e.type === 'trumpPlay') {
        const ids = Array.isArray(e.args?.cardIds) ? e.args.cardIds : [];
        if (ids.length >= 4) revolution = true;
        if (isEightCutPlay(ids, cardById)) eightCut = true;
        if (isSequence(cards)) stairs = true;
        if (isJokerSingle(cards)) jokerSingle = true;
        // ♠3返し: 直前のトランプ出しが「他人のジョーカー単騎」だったか
        if (isSpadeThreeSingle(cards) && prevTrumpPlay
            && prevTrumpPlay.by !== uid && isJokerSingle(prevTrumpPlay.cards)) {
          spadeThree = true;
        }
        lastTrumpPlayIdx = i;
      } else if (e.type === 'unoPlay') {
        // カウンター: 直前に他人が出した +2/+4 に、自分も +2/+4 を重ねた
        if (isDraw2 && prevUnoDraw2 && prevUnoDraw2.by !== uid) drawStack = true;
        lastUnoPlayIdx = i;
      }
    }

    // 記録の更新（自分の手も含めて、次のエントリから見た「直前」になる）
    if (e.type === 'trumpPlay') prevTrumpPlay = { by: e.playerId, cards };
    if (e.type === 'unoPlay') prevUnoDraw2 = isDraw2 ? { by: e.playerId } : null;
    // ドローが実行された＝累積が解消したので、返し判定の連鎖を切る
    if (e.type === 'unoDraw') prevUnoDraw2 = null;
  });

  let doubleFinish = false;
  if (finished && lastTrumpPlayIdx !== -1 && lastUnoPlayIdx !== -1 && lastTrumpPlayIdx < lastUnoPlayIdx) {
    // 最後のトランプ出しと最後のUNO出しが「同じ手番」かを見る。
    //
    // ★不具合修正（最下位に必ず付いてしまう）★
    // 以前は「間に他プレイヤーの操作が無いこと」だけを条件にしていた。
    // しかし他の全員が上がると最下位の人は1人で手番を回し続けるため、
    // 何手番あとにUNOを出し切っても「間に他人が居ない」が成立してしまい、
    // 最下位には必ずこの実績が付いていた。
    //
    // 手番の切れ目は行動の種類で分かるので、そちらで判定する:
    //  - trumpPlay/trumpPass/trumpSkip … 新しいトランプフェイズ＝次の手番が始まった
    //  - unoDraw/unoSkip               … その手番のUNOフェイズが出さずに終わった
    // 逆に sayUno / pickParentColor / yachtDuel は同じ手番の中で起こるので跨いでよい。
    let sameTurn = true;
    for (let i = lastTrumpPlayIdx + 1; i < lastUnoPlayIdx; i++) {
      const e = actionLog[i]!;
      if (e.playerId !== uid || TURN_BOUNDARY_TYPES.has(e.type)) { sameTurn = false; break; }
    }
    doubleFinish = sameTurn;
  }

  return {
    sayUnoCount, revolution, eightCut, doubleFinish,
    stairs, jokerSingle, spadeThree, drawStack,
    yachtChallenged, yachtBest, yachtWins, parentColorCount,
  };
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
  statsAfter: { games: number; wins: number; winStreak: number; loseStreak: number };
  rank: number;
  /** このゲーム反映後の累計UNO宣言数 */
  sayUnoCumulative: number;
  /** ★M4★ このゲーム反映後の累計ヨット対決の勝利数 */
  yachtWinCumulative: number;
  /** ★M4★ このゲーム反映後の累計・親の権限の使用回数 */
  parentColorCumulative: number;
  actions: PlayerActions;
}

/**
 * このゲームで「条件を満たしている」実績IDの一覧を返す（純粋関数）。
 * 既に解除済みかどうかは考慮しない（呼び出し側が新規分だけを記録する）。
 *
 * ★ID契約★ ここで返すIDは、フロントの表示メタ情報（src/achievements.ts の
 * ACHIEVEMENTS）と一致していなければならない。片方だけ足すと、解除されても
 * 画面に出ない（または名前の無い実績が出る）。
 */
export function evaluateAchievements(input: EvaluateInput): string[] {
  const out: string[] = [];
  const beforeWins = input.statsBefore?.wins ?? 0;
  const a = input.actions;

  if (input.statsAfter.games >= 1) out.push('first-game');
  if (input.rank === 1 && beforeWins === 0) out.push('first-win');
  if (input.statsAfter.games >= 10) out.push('games-10');
  if (input.statsAfter.winStreak >= 3) out.push('streak-win-3');
  if (input.statsAfter.loseStreak >= 3) out.push('streak-lose-3');
  if (input.sayUnoCumulative >= 5) out.push('uno-declare-5');
  if (a.revolution) out.push('revolution');
  if (a.eightCut) out.push('eight-cut');
  if (a.doubleFinish) out.push('double-finish');

  // ---- ★M4で追加した10種★ ----
  // トランプの技
  if (a.stairs) out.push('stairs');
  if (a.jokerSingle) out.push('joker-single');
  if (a.spadeThree) out.push('spade-three');
  // UNOの返し
  if (a.drawStack) out.push('draw-stack');
  // ヨットモード
  if (a.yachtChallenged) out.push('yacht-first');
  if (a.yachtBest) out.push('yacht-best');
  if (input.yachtWinCumulative >= 3) out.push('yacht-win-3');
  // 積み重ね
  if (input.parentColorCumulative >= 5) out.push('parent-color-5');
  if (input.statsAfter.games >= 50) out.push('games-50');
  if (input.statsAfter.wins >= 10) out.push('win-10');

  return out;
}
