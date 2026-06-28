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

  const nextPlayerId = g.order[g.ci];
  g.trumpField = [];
  g.trumpFieldMeta = null;
  g.trumpElevenBack = false;
  g.trumpSuitLock = null;
  g.hasParent  = nextPlayerId;
  const parentName = players.find(p => p.id === nextPlayerId)?.name ?? '?';

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
 * 親の権限でUNO色を変更する。
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} color
 * @param {string} playerName
 * @returns {{ logMsg: string } | null}
 */
export function applyParentColorChange(g, playerId, color, playerName) {
  if (g.hasParent !== playerId) return null;
  g.unoCurrentColor = color;
  g.hasParent = null;
  const cname = { red: '赤', blue: '青', green: '緑', yellow: '黄' }[color] ?? color;
  return { logMsg: `${playerName}が親の権限でUNOの色を【${cname}】に変更！` };
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
