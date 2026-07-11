// ========================================
// ゲーム複合ルール
//
// 責務：複数フェイズをまたぐゲームルールの判定と状態遷移。
// - DOM・Firebase・window に一切依存しない
// - この層だけで単体テストが完結する
// ========================================
import type { GameState, Player } from './types';

export interface CheckAllPassedResult {
  cleared: boolean;
  parentName: string | null;
  logMsg: string | null;
}

/**
 * トランプ手番の「全員パス判定」を行い、該当する場合に場を流す。
 *
 * @param g         - ゲーム状態（破壊的変更あり）
 * @param passCount - 現在のパス累計数（Firebaseの trumpPassCount）
 * @param players   - プレイヤー配列
 */
export function checkAllPassed(g: GameState, passCount: number, players: Player[]): CheckAllPassedResult {
  const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
  if (fCards.length === 0) return { cleared: false, parentName: null, logMsg: null };
  if (passCount < g.order.length - 1) return { cleared: false, parentName: null, logMsg: null };
  if (g.order.length === 0) return { cleared: false, parentName: null, logMsg: null };

  // ★バグ修正★ 「親」になるのは場を最後に作った人（trumpFieldOwner）。
  // g.order[g.ci] は「次の手番」であり、全員パス成立時点では
  // 単に最後にパスした本人を指してしまうため誤りだった。
  const ownerId = g.trumpFieldOwner ?? g.order[g.ci];
  g.trumpField = [];
  g.trumpFieldMeta = null;
  g.trumpFieldOwner = null;
  g.trumpElevenBack = false;
  g.trumpSuitLock = null;
  g.hasParent = ownerId;
  // ★バグ修正（ターンすっ飛ばし）★
  // 以前はここで g.ci を親(owner)のインデックスへ強制的にジャンプさせていた。
  // しかし「全員パス」が成立するのは、まさに"最後にパスしたプレイヤー"の
  // 手番の最中（applyTrumpPass が既に phase='uno' にして、そのプレイヤー自身の
  // UNOターンをセットした直後）である。ここで g.ci を親へ書き換えてしまうと、
  // 最後にパスしたプレイヤー自身のUNOターンがまるごとスキップされ、
  // まだトランプを出してもいない親がいきなりUNOフェイズ（＋親の権限）を
  // 押し付けられるという不具合が発生していた。
  //
  // checkAllPassed の責務は「場をクリアして親情報(hasParent)を記録する」ことだけに
  // 留め、手番(g.ci)・フェイズ(g.phase)には一切触れない。手番は通常どおり
  // applyUnoPlay / applyUnoDraw / applyUnoSkip 経由で自然に次のプレイヤーへ
  // 進み、その次のプレイヤーが自分のトランプターンで（場が空なので）好きに
  // 出した後、続くUNOフェイズで初めて「親」として色変更権限を使えるようになる。
  const parentName = players.find(p => p.id === ownerId)?.name ?? '?';

  return {
    cleared: true,
    parentName,
    logMsg: `全員パス！場が流れた 👑 ${parentName}が親になった`,
  };
}

/**
 * ゲーム終了時にランキングの「?」を実名に補完する。
 */
export function resolveRankingNames(rankings: { id: string; name: string }[], players: Player[]): void {
  rankings.forEach(r => {
    if (r.name === '?') {
      const p = players.find(p2 => p2.id === r.id);
      if (p) r.name = p.name;
    }
  });
}

export interface FinalizeResult {
  finished: boolean;
  isGameOver: boolean;
  logMsg: string | null;
}

/**
 * ★バグ修正で追加★
 * トランプ・UNO両方の手札が0枚になったプレイヤーを「上がり」として確定させる。
 *
 * 通常はUNOカードを出した瞬間（uno-logic.js の applyUnoPlay 内）に上がり判定が
 * 行われるが、以下のように「自動スキップ」を経由して両方0枚になるケースでは
 * この判定が一度も行われず、
 * トランプ0枚 → 自動スキップでUNOフェイズへ
 * UNO0枚      → 自動スキップでトランプフェイズへ
 * を無限に繰り返すバグ（ゲームが終了しない）が発生していた。
 *
 * このヘルパーを applyTrumpSkip / applyUnoSkip の先頭で必ず呼び出し、
 * 「本当にスキップすべきか、それとも上がり確定すべきか」を先に判定する。
 */
export function finalizeIfBothHandsEmpty(g: GameState, playerId: string, playerName: string): FinalizeResult {
  // ★バグ修正（Firebase Realtime Databaseの空配列対策仕様・再修正）★
  // Firebase Realtime Database は空配列 [] を書き込むとキーごと消す仕様であるため、
  // ゲームが進行して「残っている全員」がトランプを出し切ると、trumpHands
  // オブジェクトの中身が1人分ずつ消えていき、最後の1人が出し切った瞬間に
  // trumpHands オブジェクト自体が丸ごと消滅する（正常な状態）。
  // 「オブジェクト自体が無い」も「オブジェクトはあるがこのプレイヤーのキー
  // だけが無い」も、本番では同じ意味（＝0枚）である。単純に「無ければ0枚」で統一する。
  const trumpHand = (g.trumpHands && g.trumpHands[playerId]) || [];
  const unoHand = (g.unoHands && g.unoHands[playerId]) || [];
  const trumpDone = trumpHand.length === 0;
  const unoDone = unoHand.length === 0;

  if (!trumpDone || !unoDone) {
    return { finished: false, isGameOver: false, logMsg: null };
  }

  if (!g.rankings) g.rankings = [];
  if (!g.rankings.some(r => r.id === playerId)) {
    g.rankings.push({ id: playerId, name: playerName });
  }

  // ★バグ1対策と同じ理由★ 親の権限を持ったまま上がった場合もここで確実に失効させる
  if (g.hasParent === playerId) g.hasParent = null;

  // ★バグ修正（dir=-1 で手番がおかしくなる問題）★
  // 正しい手順：
  //   1. 除外「前」の order 上で、dir 方向に本来次に来るはずだった
  //      プレイヤーIDを特定する（自分の位置から dir 分だけ進めた位置）。
  //   2. 除外「後」の新しい order からそのIDのインデックスを探し直す。
  // こうすれば dir の向きに関わらず正しい次走者を指せる。
  const oldOrder = g.order;
  const oldLen = oldOrder.length;
  const myOldIdx = oldOrder.indexOf(playerId);
  let nextPlayerId: string | null = null;
  if (myOldIdx !== -1 && oldLen > 1) {
    const nextOldIdx = (myOldIdx + g.dir + oldLen) % oldLen;
    nextPlayerId = oldOrder[nextOldIdx];
  }

  g.order = oldOrder.filter(id => id !== playerId);
  const newLen = g.order.length;
  const isGameOver = newLen <= 1;

  if (isGameOver && newLen === 1) {
    const lastId = g.order[0];
    if (!g.rankings.some(r => r.id === lastId)) {
      g.rankings.push({ id: lastId, name: '?' });
    }
  }

  if (!isGameOver) {
    g.phase = 'trump';
    const nextIdx = nextPlayerId !== null ? g.order.indexOf(nextPlayerId) : -1;
    g.ci = nextIdx !== -1 ? nextIdx : 0;
  }

  return { finished: true, isGameOver, logMsg: `${playerName}が上がりました！🎉` };
}

export interface SkipResult {
  logMsg: string;
  isGameOver: boolean;
  finished: boolean;
}

/**
 * トランプ手番をスキップしてUNOフェイズへ進める（手札0枚の場合）。
 *
 * ★バグ修正★ playerId を受け取るようになった。スキップする前に
 * finalizeIfBothHandsEmpty で「UNO手札も0枚か」を必ず確認し、
 * 両方0枚ならUNOフェイズへは進めず、その場で上がり確定させる。
 */
export function applyTrumpSkip(g: GameState, playerId: string, playerName: string): SkipResult {
  const finalize = finalizeIfBothHandsEmpty(g, playerId, playerName);
  if (finalize.finished) {
    return { logMsg: finalize.logMsg as string, isGameOver: finalize.isGameOver, finished: true };
  }
  g.phase = 'uno';
  return { logMsg: `${playerName}のトランプは0枚（自動スキップ）→ UNOフェイズへ`, isGameOver: false, finished: false };
}

/**
 * ★バグ修正で追加★
 * UNO手番をスキップして次のプレイヤーのトランプフェイズへ進める（UNO手札0枚の場合）。
 * applyTrumpSkip と違い、UNOフェイズはターンの最後の工程なので
 * 次のプレイヤーへ手番を進める必要がある（applyUnoPlay・applyUnoDraw と同様）。
 *
 * 自分が親（g.hasParent === playerId）の場合、色変更の権限を使わずに
 * スキップしたとみなし、権限はここで消滅する（次のUNOフェイズへ持ち越さない）。
 *
 * ★バグ修正★ スキップする前に finalizeIfBothHandsEmpty で
 * 「トランプ手札も0枚か」を必ず確認し、両方0枚ならトランプフェイズへは進めず、
 * その場で上がり確定させる（無限スキップループの解消）。
 */
export function applyUnoSkip(g: GameState, playerId: string, playerName: string): SkipResult {
  const finalize = finalizeIfBothHandsEmpty(g, playerId, playerName);
  if (finalize.finished) {
    return { logMsg: finalize.logMsg as string, isGameOver: finalize.isGameOver, finished: true };
  }

  const n = g.order.length;
  const wasParent = g.hasParent === playerId;
  if (wasParent) g.hasParent = null;
  g.phase = 'trump';
  const myIdx = g.order.indexOf(playerId);
  if (myIdx !== -1 && n > 0) g.ci = (myIdx + g.dir + n) % n;
  const parentNote = wasParent ? '（親の色変更権限は行使せず終了）' : '';
  return { logMsg: `${playerName}のUNOは0枚（自動スキップ）→ 次のトランプフェイズへ${parentNote}`, isGameOver: false, finished: false };
}

export interface ParentColorChangeResult {
  logMsg: string;
  turnAdvanced: boolean;
  /** 色変更と同時にトランプ・UNO両方の手札が0枚となり上がりが確定した場合（finalizeIfBothHandsEmpty経由）のみ存在する */
  finished?: boolean;
  /** 同上。finished が true の場合のみ意味を持つ */
  isGameOver?: boolean;
}

/**
 * 親の権限でUNO色を変更する。
 *
 * ★仕様修正★ UNOを出し切っている親の場合、色変更は「UNOフェイズの再開」を
 * 意味しない。色変更後（または変更せず見送る場合）は即座にトランプフェイズの
 * 次のプレイヤーへターンを進める。UNO未出し切りの親の場合は従来通り、
 * 色変更後そのまま自分のUNOフェイズ行動（出す/引く）に続く。
 */
export function applyParentColorChange(
  g: GameState,
  playerId: string,
  color: string,
  playerName: string
): ParentColorChangeResult | null {
  if (g.hasParent !== playerId) return null;
  g.unoCurrentColor = color;
  g.hasParent = null;
  const cname = ({ red: '赤', blue: '青', green: '緑', yellow: '黄' } as Record<string, string>)[color] ?? color;
  let logMsg = `${playerName}が親の権限でUNOの色を【${cname}】に変更！`;

  // ★バグ修正（親の権限行使タイミングで上がり判定が漏れる問題）★
  // 色変更を行使する時点で、実はトランプ・UNOの両方がすでに0枚
  // （＝本来は上がっているはず）というケースが考慮されていなかった。
  // このままだと rankings にも order 除外にも一切反映されず、
  // そのプレイヤーがゲームに永久に残り続けてしまう。
  // 色変更そのものは有効な行為として先に確定させた上で、
  // 直後に必ず上がり判定を行う。
  const finalize = finalizeIfBothHandsEmpty(g, playerId, playerName);
  if (finalize.finished) {
    return {
      logMsg: `${logMsg}\n${finalize.logMsg}`,
      turnAdvanced: true,
      finished: true,
      isGameOver: finalize.isGameOver,
    };
  }

  const myUno = (g.unoHands && g.unoHands[playerId]) || [];
  const myUnoDone = myUno.length === 0;
  let turnAdvanced = false;
  if (myUnoDone) {
    // UNO出し切り済み：色変更だけで完了。通常のUNOフェイズ行動はできないので
    // そのままトランプフェイズの次のプレイヤーへ進める。
    const n = g.order.length;
    g.phase = 'trump';
    const myIdx = g.order.indexOf(playerId);
    if (myIdx !== -1 && n > 0) g.ci = (myIdx + g.dir + n) % n;
    turnAdvanced = true;
    logMsg += '（UNOは出し切り済みのため次のプレイヤーへ）';
  }

  return { logMsg, turnAdvanced };
}

export interface UnoDeclarationResult {
  logMsg: string;
}

/**
 * UNO宣言を記録する。
 */
export function applyUnoDeclaration(g: GameState, playerId: string, playerName: string): UnoDeclarationResult {
  if (!g.unoSaid) g.unoSaid = {};
  g.unoSaid[playerId] = true;
  return { logMsg: `${playerName}が「UNO！」と叫んだ 🎉` };
}

// ========================================
// ★機能追加★ 不変条件チェック（診断専用・書き込みはブロックしない）
//
// game-actions.js から各アクションの fbUpdate 直前に呼ばれ、
// 「本来ありえないはずのゲーム状態」になっていないかを検出してconsoleに
// 警告を出す。ここで見つかったものは全て「バグの兆候」であり、
// ゲームプレイ自体は止めない（診断専用）。
// ========================================

/**
 * ゲーム状態の不変条件をチェックし、違反のメッセージ一覧を返す。
 */
export function checkInvariants(g: GameState, players: Player[]): string[] {
  const violations: string[] = [];
  if (!g) return violations;

  const playerIds = (players || []).map(p => p.id);

  // ---- トランプの総枚数チェック ----
  // ★注意★ このゲームは8切り／ジョーカー単体／スペ3／全員パスで
  // 場のカードがそのままゲームから除外され、手札にも捨て札にも一切
  // 戻らない仕様（＝トランプ用の捨て札置き場が存在しない）。そのため
  // 「手札合計＋場＝53枚」を“完全一致”で検証することはできず、
  // プレイが進むほど正しく53枚未満になっていく（これは仕様であり
  // バグではない）。
  // ここでは「53枚を超えていないか（＝カードが重複生成されていないか）」
  // だけを検証する。
  const trumpHandTotal = playerIds.reduce(
    (sum, id) => sum + ((g.trumpHands && g.trumpHands[id]) || []).length,
    0
  );
  const trumpFieldTotal = Array.isArray(g.trumpField) ? g.trumpField.length : 0;
  const trumpTotal = trumpHandTotal + trumpFieldTotal;
  if (trumpTotal > 53) {
    violations.push(
      `トランプの総枚数が53枚を超えている（手札合計${trumpHandTotal} + 場${trumpFieldTotal} = ${trumpTotal}枚）`
    );
  }

  // ---- トランプカードの重複チェック ----
  const allTrumpIds: string[] = [];
  playerIds.forEach(id => {
    ((g.trumpHands && g.trumpHands[id]) || []).forEach(c => allTrumpIds.push(c.id));
  });
  (Array.isArray(g.trumpField) ? g.trumpField : []).forEach(c => allTrumpIds.push(c.id));
  const dupTrump = [...new Set(allTrumpIds.filter((id, i) => allTrumpIds.indexOf(id) !== i))];
  if (dupTrump.length > 0) {
    violations.push(`同じトランプカードが複数箇所に存在する: ${dupTrump.join(', ')}`);
  }

  // ---- UNOの総枚数チェック（標準108枚固定・手札+山札+捨て札で完結） ----
  // UNOはトランプと異なり捨て札置き場（unoDiscardPile）があるため、
  // 常に「手札合計＋山札＋捨て札＝108枚」で一致するはずである。
  const unoHandTotal = playerIds.reduce(
    (sum, id) => sum + ((g.unoHands && g.unoHands[id]) || []).length,
    0
  );
  const unoDrawTotal = Array.isArray(g.unoDrawPile) ? g.unoDrawPile.length : 0;
  const unoDiscardTotal = Array.isArray(g.unoDiscardPile) ? g.unoDiscardPile.length : 0;
  const unoTotal = unoHandTotal + unoDrawTotal + unoDiscardTotal;
  if (unoTotal !== 108) {
    violations.push(
      `UNOの総枚数が108枚ではない（手札合計${unoHandTotal} + 山札${unoDrawTotal} + 捨て札${unoDiscardTotal} = ${unoTotal}枚）`
    );
  }

  // ---- g.ci が order の範囲内か ----
  if (Array.isArray(g.order) && g.order.length > 0) {
    if (typeof g.ci !== 'number' || g.ci < 0 || g.ci >= g.order.length) {
      violations.push(`g.ci（${g.ci}）が order（長さ${g.order.length}）の範囲外`);
    }
  }

  // ---- hasParent が実在するプレイヤーIDか ----
  if (g.hasParent && !playerIds.includes(g.hasParent)) {
    violations.push(`hasParent（${g.hasParent}）が players に存在しないプレイヤーを指している`);
  }

  // ---- rankings の重複チェック ----
  if (Array.isArray(g.rankings)) {
    const rankIds = g.rankings.map(r => r.id);
    const dupRanks = [...new Set(rankIds.filter((id, i) => rankIds.indexOf(id) !== i))];
    if (dupRanks.length > 0) {
      violations.push(`rankings に同じプレイヤーが複数回登録されている: ${dupRanks.join(', ')}`);
    }

    // ---- 上がり確定済みのプレイヤーが order に残っていないか ----
    if (Array.isArray(g.order)) {
      const stillInOrder = rankIds.filter(id => g.order.includes(id));
      if (stillInOrder.length > 0) {
        violations.push(
          `上がり確定済み（rankings）のプレイヤーがまだ order に残っている: ${stillInOrder.join(', ')}`
        );
      }
    }
  }

  return violations;
}

/**
 * checkInvariants で見つかった違反をコンソールへ出力する。
 * 診断専用（ここでは何も投げない・書き込みは止めない）。
 */
export function reportInvariantViolations(actionName: string, g: GameState, violations: string[]): void {
  if (!violations || violations.length === 0) return;
  console.error(`🚨 [不変条件違反] ${actionName} の実行後、ゲーム状態が不正です:`);
  violations.forEach(v => console.error(`  - ${v}`));
}