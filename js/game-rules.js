// ========================================
// ゲーム複合ルール
//
// 責務：複数フェイズをまたぐゲームルールの判定と状態遷移。
// - DOM・Firebase・window に一切依存しない
// - この層だけで単体テストが完結する
// ========================================

/**
 * トランプ手番の「全員パス判定」を行い、該当する場合に場を流す。
 *
 * @param {object} g         - ゲーム状態（破壊的変更あり）
 * @param {number} passCount - 現在のパス累計数（Firebaseの trumpPassCount）
 * @param {object[]} players - プレイヤー配列 [{ id, name }]
 * @returns {{ cleared: boolean, parentName: string|null, logMsg: string|null }}
 */
export function checkAllPassed(g, passCount, players) {
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
  g.hasParent  = ownerId;
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
 *
 * @param {object[]} rankings - g.rankings（破壊的変更あり）
 * @param {object[]} players  - プレイヤー配列 [{ id, name }]
 */
export function resolveRankingNames(rankings, players) {
  rankings.forEach(r => {
    if (r.name === '?') {
      const p = players.find(p2 => p2.id === r.id);
      if (p) r.name = p.name;
    }
  });
}

/**
 * トランプ手番をスキップしてUNOフェイズへ進める（手札0枚の場合）。
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerName
 * @returns {{ logMsg: string }}
 */
export function applyTrumpSkip(g, playerName) {
  g.phase = 'uno';
  return { logMsg: `${playerName}のトランプは0枚（自動スキップ）→ UNOフェイズへ` };
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
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} playerName
 * @returns {{ logMsg: string }}
 */
export function applyUnoSkip(g, playerId, playerName) {
  const n = g.order.length;
  const wasParent = g.hasParent === playerId;
  if (wasParent) g.hasParent = null;
  g.phase = 'trump';
  const myIdx = g.order.indexOf(playerId);
  if (myIdx !== -1 && n > 0) g.ci = (myIdx + g.dir + n) % n;
  const parentNote = wasParent ? '（親の色変更権限は行使せず終了）' : '';
  return { logMsg: `${playerName}のUNOは0枚（自動スキップ）→ 次のトランプフェイズへ${parentNote}` };
}

/**
 * 親の権限でUNO色を変更する。
 *
 * ★仕様修正★ UNOを出し切っている親の場合、色変更は「UNOフェイズの再開」を
 * 意味しない。色変更後（または変更せず見送る場合）は即座にトランプフェイズの
 * 次のプレイヤーへターンを進める。UNO未出し切りの親の場合は従来通り、
 * 色変更後そのまま自分のUNOフェイズ行動（出す/引く）に続く。
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} color
 * @param {string} playerName
 * @returns {{ logMsg: string, turnAdvanced: boolean } | null}
 */
export function applyParentColorChange(g, playerId, color, playerName) {
  if (g.hasParent !== playerId) return null;
  g.unoCurrentColor = color;
  g.hasParent = null;
  const cname = { red: '赤', blue: '青', green: '緑', yellow: '黄' }[color] ?? color;
  let logMsg = `${playerName}が親の権限でUNOの色を【${cname}】に変更！`;

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

/**
 * UNO宣言を記録する。
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} playerName
 * @returns {{ logMsg: string }}
 */
export function applyUnoDeclaration(g, playerId, playerName) {
  if (!g.unoSaid) g.unoSaid = {};
  g.unoSaid[playerId] = true;
  return { logMsg: `${playerName}が「UNO！」と叫んだ 🎉` };
}
