// ========================================
// 在席状態（presence）— Phase 4 後半
//
// フレンドが「今オンラインか／どのルームで遊んでいるか」を見せるための仕組み。
// Realtime Database の onDisconnect を使い、タブを閉じる・切断すると
// サーバー側で自動的に presence/{uid} が消える（＝オフライン扱いになる）。
//
// - startPresence(uid): ログイン時に online として登録＋切断時削除を予約
// - setPresenceRoom(roomId|null): ルーム入室/退室で状態を更新
// - stopPresence(): ログアウト時に予約解除＋削除
// - watchPresence(uid, cb): フレンド1人の在席を購読（フレンド一覧で使用）
//
// ★重要★ presence の読み書き失敗はゲーム/フレンド機能を止めない
// （本番RDBのルールに presence パスが無い場合は静かに無効化されるだけ）。
// ========================================
import { db } from './firebase-config.js';
import {
  ref, set, remove, onValue, onDisconnect, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

let myUid: string | null = null;
let currentRoomId: string | null = null;

function myRef() {
  return myUid ? ref(db, 'presence/' + myUid) : null;
}

async function writePresence(): Promise<void> {
  const r = myRef();
  if (!r) return;
  try {
    await set(r, {
      state: currentRoomId ? 'in-room' : 'online',
      roomId: currentRoomId ?? null,
      at: serverTimestamp(),
    });
  } catch { /* ルール未設定などは無視 */ }
}

/** ログイン時に呼ぶ。online 登録＋切断時の自動削除を予約する */
export function startPresence(uid: string): void {
  if (myUid === uid) return;
  myUid = uid;
  currentRoomId = null;
  const r = myRef();
  if (!r) return;
  try {
    // 切断（タブを閉じる・ネット断）で自動的にオフラインになるよう予約
    onDisconnect(r).remove().catch(() => {});
  } catch { /* 無視 */ }
  void writePresence();
}

/** ルーム入室/退室で状態を更新する（roomId=null で「ロビー外・オンライン」） */
export function setPresenceRoom(roomId: string | null): void {
  if (!myUid) return;
  currentRoomId = roomId || null;
  void writePresence();
}

/** ログアウト時に呼ぶ。予約解除＋presence削除 */
export function stopPresence(): void {
  const r = myRef();
  if (r) {
    try { onDisconnect(r).cancel().catch(() => {}); } catch { /* 無視 */ }
    remove(r).catch(() => {});
  }
  myUid = null;
  currentRoomId = null;
}

export interface PresenceInfo {
  state: 'online' | 'in-room';
  roomId: string | null;
}

/** フレンド1人の在席を購読する。返り値の unsubscribe で解除 */
export function watchPresence(uid: string, cb: (info: PresenceInfo | null) => void): () => void {
  try {
    const r = ref(db, 'presence/' + uid);
    return onValue(r, (snap: any) => {
      const v = snap.val();
      if (!v) { cb(null); return; }
      cb({ state: v.state === 'in-room' ? 'in-room' : 'online', roomId: v.roomId ?? null });
    }, () => cb(null));
  } catch {
    return () => {};
  }
}
