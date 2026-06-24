// ========================================
// Firebase DB ヘルパー関数
// ========================================
import { db } from "./firebase-config.js";
import { ref, set, update, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export async function fbGet(path) {
  const snapshot = await get(ref(db, path));
  return snapshot.val();
}

export async function fbSet(path, data) {
  await set(ref(db, path), data);
  return data;
}

export async function fbUpdate(path, data) {
  await update(ref(db, path), data);
  return data;
}

/**
 * リアルタイムリスナーを開始する
 * @param {string} path - 監視するパス
 * @param {function} onData - データ変更時のコールバック (data) => void
 * @param {function} onError - エラー時のコールバック (err) => void
 * @returns {function} - リスナーを解除するための unsubscribe 関数
 */
export function fbListen(path, onData, onError) {
  const r = ref(db, path);
  const unsub = onValue(r, (snap) => onData(snap.val()), onError);
  return unsub;
}

/**
 * 接続テスト
 * @returns {Promise<boolean>}
 */
export async function testConnection() {
  try {
    await fbSet("rooms/_test_", { ts: Date.now() });
    const data = await fbGet("rooms/_test_");
    return !!data;
  } catch {
    return false;
  }
}
