// ========================================
// フレンド機能のデータ層（Phase 4・承認制）
//
// フレンド関係は「2人1組で1ドキュメント」friendships/{pairId} に持つ。
//   pairId = [a,b].sort().join('_') / members:[a,b] / status:'pending'|'accepted'
//   / requestedBy: 申請者uid
// 申請=create(pending) / 承認=update(accepted) / 拒否・取消・解除=delete。
// Cloud Functions は不要で、Firestore ルールだけで安全に成立させる。
//
// このファイルは Firestore 呼び出しをまとめる。pairId 計算など純粋な部分は
// export してルートの vitest でテストする。
// ========================================
import { firestore } from './firebase-config.js';
import {
  doc, collection, query, where, orderBy, limit,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { pairId, generateCode } from './friends-util.js';

export { pairId, generateCode };

export interface Friendship {
  pairId: string;
  members: string[];
  status: 'pending' | 'accepted';
  requestedBy: string;
}

/**
 * 自分のフレンドコードを取得（無ければ生成して users/{uid}.friendCode と
 * 逆引き friendCodes/{code} を作る）。失敗時は null。
 */
export async function ensureFriendCode(uid: string): Promise<string | null> {
  try {
    const uref = doc(firestore, 'users', uid);
    const snap = await getDoc(uref);
    const existing = snap.exists() ? snap.data().friendCode : null;
    if (typeof existing === 'string' && existing.length > 0) return existing;

    // 衝突したら数回リトライ
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = generateCode();
      const cref = doc(firestore, 'friendCodes', code);
      if ((await getDoc(cref)).exists()) continue;
      await setDoc(cref, { uid });               // 逆引きインデックス
      await updateDoc(uref, { friendCode: code }); // プロフィールにも保存
      return code;
    }
    return null;
  } catch (e) {
    console.warn('フレンドコードの取得/生成に失敗:', e);
    return null;
  }
}

/** フレンドコードから相手のuidを引く（get のみ・列挙不可）。無ければ null */
export async function resolveFriendCode(code: string): Promise<string | null> {
  try {
    const snap = await getDoc(doc(firestore, 'friendCodes', code.trim().toUpperCase()));
    return snap.exists() ? (snap.data().uid ?? null) : null;
  } catch (e) {
    console.warn('フレンドコードの解決に失敗:', e);
    return null;
  }
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: 'self' | 'exists' | 'pending' | 'error' };

/** 申請を送る（相手uid指定）。既に関係があればその旨を返す */
export async function sendFriendRequest(myUid: string, targetUid: string): Promise<SendResult> {
  if (!targetUid || targetUid === myUid) return { ok: false, reason: 'self' };
  try {
    const id = pairId(myUid, targetUid);
    const ref = doc(firestore, 'friendships', id);
    const existing = await getDoc(ref);
    if (existing.exists()) {
      const st = existing.data().status;
      return { ok: false, reason: st === 'accepted' ? 'exists' : 'pending' };
    }
    await setDoc(ref, {
      members: [myUid, targetUid],
      status: 'pending',
      requestedBy: myUid,
      createdAt: serverTimestamp(),
    });
    return { ok: true };
  } catch (e) {
    console.warn('フレンド申請に失敗:', e);
    return { ok: false, reason: 'error' };
  }
}

/** 申請を承認する（相手側が pending→accepted に） */
export async function acceptFriend(id: string): Promise<boolean> {
  try {
    await updateDoc(doc(firestore, 'friendships', id), { status: 'accepted' });
    return true;
  } catch (e) {
    console.warn('承認に失敗:', e);
    return false;
  }
}

/** 拒否・取消・フレンド解除（いずれもドキュメント削除） */
export async function removeFriendship(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(firestore, 'friendships', id));
    return true;
  } catch (e) {
    console.warn('フレンド関係の削除に失敗:', e);
    return false;
  }
}

/**
 * 自分が当事者のフレンド関係を購読する。
 * コールバックには Friendship の配列を渡す（UI側で pending/accepted に振り分ける）。
 */
export function listenFriendships(myUid: string, cb: (list: Friendship[]) => void): () => void {
  try {
    const q = query(collection(firestore, 'friendships'), where('members', 'array-contains', myUid));
    return onSnapshot(q, (snap: any) => {
      const list: Friendship[] = [];
      snap.forEach((d: any) => {
        const data = d.data();
        list.push({ pairId: d.id, members: data.members, status: data.status, requestedBy: data.requestedBy });
      });
      cb(list);
    }, (e: any) => console.warn('フレンド購読エラー:', e));
  } catch (e) {
    console.warn('フレンド購読の開始に失敗:', e);
    return () => {};
  }
}

/** 表示名の取得（複数uid・公開読み取り）。取得失敗は uid の先頭でフォールバック */
export async function fetchNames(uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(uids.map(async (uid) => {
    try {
      const s = await getDoc(doc(firestore, 'users', uid));
      out[uid] = (s.exists() && typeof s.data().displayName === 'string') ? s.data().displayName : 'プレイヤー';
    } catch { out[uid] = 'プレイヤー'; }
  }));
  return out;
}

/**
 * 直近の対局で一緒だったプレイヤー（自分・重複を除く）を新しい順に返す。
 * users/{uid}/games の participants を使う（Phase 2 で記録済み）。
 */
export async function recentCoPlayers(myUid: string, gamesToScan = 3): Promise<{ uid: string; name: string }[]> {
  try {
    const q = query(
      collection(firestore, 'users', myUid, 'games'),
      orderBy('finishedAt', 'desc'),
      limit(gamesToScan)
    );
    const snap = await getDocs(q);
    const seen = new Set<string>([myUid]);
    const out: { uid: string; name: string }[] = [];
    snap.forEach((d: any) => {
      const parts = d.data().participants;
      if (!Array.isArray(parts)) return;
      for (const p of parts) {
        if (p && typeof p.uid === 'string' && !seen.has(p.uid)) {
          seen.add(p.uid);
          out.push({ uid: p.uid, name: typeof p.name === 'string' ? p.name : 'プレイヤー' });
        }
      }
    });
    return out;
  } catch (e) {
    console.warn('直近プレイヤーの取得に失敗:', e);
    return [];
  }
}
