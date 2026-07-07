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
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} playerName
 * @returns {{ finished: boolean, isGameOver: boolean, logMsg: string|null }}
 */
export function finalizeIfBothHandsEmpty(g, playerId, playerName) {
  // ★バグ修正（Firebase Realtime Databaseの空配列対策仕様・再修正）★
  // 以前はここで「g.trumpHands / g.unoHands オブジェクト自体が無ければ
  // finished:false で即return」としていたが、これは意図（コメント）と
  // 実装が矛盾していた。「オブジェクト自体が消えている」のはまさに
  // 「全員の手札が0枚になった」時にFirebaseが空配列ごとキーを削除する
  // ケースであり、本来は「0枚として扱う」べきところを「判定不能として
  // 諦める」実装になっていた。
  // これにより、全員トランプ0枚（g.trumpHands が丸ごと undefined）に
  // なった瞬間から、このプレイヤーのUNOも0枚になっても上がりが二度と
  // 検出されなくなる（applyTrumpSkip / applyUnoSkip / applyParentColorChange
  // 全てがこの関数に依存しているため影響大）という不具合があった。
  //
  // g.trumpHands[playerId] / g.unoHands[playerId] を直接読まず、
  // オブジェクト自体が無い場合もオプショナルチェーン相当の書き方で
  // 「0枚」として扱う。
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
  // 以前は「除外前の g.ci をそのまま新しい order の長さで割った余り」で
  // 次の手番を求めていたが、これは dir=1（時計回り）の場合にしか正しく
  // 動かないトリックだった。dir=-1（反時計回り、UNOのリバース後）だと
  // 本来「前の人」に手番が渡るべきところ、別の人に飛んでしまっていた。
  //
  // 正しい手順：
  //   1. 除外「前」の order 上で、dir 方向に本来次に来るはずだった
  //      プレイヤーIDを特定する（自分の位置から dir 分だけ進めた位置）。
  //   2. 除外「後」の新しい order からそのIDのインデックスを探し直す。
  // こうすれば dir の向きに関わらず正しい次走者を指せる。
  const oldOrder = g.order;
  const oldLen = oldOrder.length;
  const myOldIdx = oldOrder.indexOf(playerId);
  let nextPlayerId = null;
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

/**
 * トランプ手番をスキップしてUNOフェイズへ進める（手札0枚の場合）。
 *
 * ★バグ修正★ playerId を受け取るようになった。スキップする前に
 * finalizeIfBothHandsEmpty で「UNO手札も0枚か」を必ず確認し、
 * 両方0枚ならUNOフェイズへは進めず、その場で上がり確定させる。
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} playerName
 * @returns {{ logMsg: string, isGameOver: boolean, finished: boolean }}
 */
export function applyTrumpSkip(g, playerId, playerName) {
  const finalize = finalizeIfBothHandsEmpty(g, playerId, playerName);
  if (finalize.finished) {
    return { logMsg: finalize.logMsg, isGameOver: finalize.isGameOver, finished: true };
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
 *
 * @param {object} g          - ゲーム状態（破壊的変更あり）
 * @param {string} playerId
 * @param {string} playerName
 * @returns {{ logMsg: string, isGameOver: boolean, finished: boolean }}
 */
export function applyUnoSkip(g, playerId, playerName) {
  const finalize = finalizeIfBothHandsEmpty(g, playerId, playerName);
  if (finalize.finished) {
    return { logMsg: finalize.logMsg, isGameOver: finalize.isGameOver, finished: true };
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
