// ========================================
// リプレイ機能: actionLog 書き込みヘルパー
//
// game-actions.js に既にある appendLog(room, logMsg)（log配列に追記する
// 既存ヘルパー）と、全く同じパターンで作ってある。
// 新しいFirebase書き込み経路は作らず、既存の fbUpdate 呼び出しに
// 1行乗せるだけで済むようにするための関数。
// ========================================
import type { ReplayActionLogEntry, ReplayActionType, ReplayActionArgs } from './replay-types';

// 安全弁：万が一バグでゲームが終わらず操作が無限に続いた場合でも、
// actionLog が際限なく肥大化してFirebaseの1ノードサイズを圧迫しないようにする上限。
const MAX_ACTION_LOG_LENGTH = 2000;

/**
 * actionLog に追記する1件分のエントリを組み立てる。
 * @param type   操作の種類（'trumpPlay' など）
 * @param playerId 操作したプレイヤーのID
 * @param args   再生に必要な引数（カードIDや選択した色など）
 */
export function makeActionLogEntry(
  type: ReplayActionType,
  playerId: string,
  args: ReplayActionArgs
): ReplayActionLogEntry {
  return { type, playerId, args, ts: Date.now() };
}

/**
 * room.actionLog に1件追記した「新しい配列」を返す（元の配列は変更しない）。
 *
 * room.actionLog が配列でない場合（＝この機能が実装される前に始まった
 * 古いルームなど、まだ actionStartGame で初期化されていない場合）は
 * 追記せずに null を返す。
 *
 * 呼び出し側（game-actions.js）は、この戻り値が null なら
 * fbUpdate に actionLog キー自体を含めないようにする。
 * こうすることで、古いルームのデータ構造を壊さずに済む。
 */
export function appendActionLog(
  room: { actionLog?: ReplayActionLogEntry[] | null },
  entry: ReplayActionLogEntry
): ReplayActionLogEntry[] | null {
  if (!Array.isArray(room.actionLog)) return null;
  if (room.actionLog.length >= MAX_ACTION_LOG_LENGTH) {
    // 安全弁が働いた場合は、それ以上追記せず現状の配列をそのまま返す
    return room.actionLog;
  }
  return [...room.actionLog, entry];
}
