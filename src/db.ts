// ========================================
// Firebase DB ヘルパー関数
// ========================================
import { db } from "./firebase-config.js";
import { ref, set, update, get, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export async function fbGet(path: string): Promise<any> {
  const snapshot = await get(ref(db, path));
  return snapshot.val();
}

export async function fbSet<T>(path: string, data: T): Promise<T> {
  await set(ref(db, path), data);
  return data;
}

export async function fbUpdate<T>(path: string, data: T): Promise<T> {
  await update(ref(db, path), data);
  return data;
}

/**
 * リアルタイムリスナーを開始する
 * @returns リスナーを解除するための unsubscribe 関数
 */
export function fbListen(
  path: string,
  onData: (data: any) => void,
  onError?: (err: Error) => void
): () => void {
  const r = ref(db, path);
  const unsub = onValue(r, (snap: any) => onData(snap.val()), onError);
  return unsub;
}

/**
 * 接続テスト
 */
export async function testConnection(): Promise<boolean> {
  try {
    await fbSet("rooms/_test_", { ts: Date.now() });
    const data = await fbGet("rooms/_test_");
    return !!data;
  } catch {
    return false;
  }
}
