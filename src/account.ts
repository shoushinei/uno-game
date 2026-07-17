// ========================================
// アカウント（Firestore users/{uid}）の管理 — Phase 1
//
// Googleログインしたユーザーのプロフィールを Cloud Firestore に持つ。
// - 初回ログイン時に users/{uid} を自動作成（登録フロー無し＝パスワードレス方針）
// - 表示名はここに保存し、毎回の名前入力を廃止する
// - ゲスト（匿名認証）はドキュメントを作らない＝アカウント機能なし
// - 戦績・実績のフィールドは Phase 2 以降で Cloud Functions が書き込む
//
// ★重要★ Firestore への読み書きが失敗しても、ゲームのプレイ自体は
// 止めない（アカウント機能は常に「あれば嬉しい」扱い）。呼び出し側は
// null が返る前提で動くこと。
// ========================================
import { firestore } from './firebase-config.js';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/** users/{uid} ドキュメントのクライアントから見える形 */
export interface UserProfile {
  displayName: string;
  /** アイコン・称号は Phase 5 で使う（席だけ先に用意） */
  selectedIcon: string | null;
  selectedTitle: string | null;
}

/**
 * Googleユーザーのプロフィールを取得し、無ければ作る（初回ログイン＝自動アカウント作成）。
 * 失敗したら null（ゲームは続行可能）。
 */
export async function ensureUserDoc(user: {
  uid: string;
  displayName: string | null;
  isAnonymous: boolean;
}): Promise<UserProfile | null> {
  if (user.isAnonymous) return null; // ゲストはアカウントを作らない
  try {
    const ref = doc(firestore, 'users', user.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return {
        displayName: typeof d.displayName === 'string' ? d.displayName : 'プレイヤー',
        selectedIcon: d.selectedIcon ?? null,
        selectedTitle: d.selectedTitle ?? null,
      };
    }
    const profile: UserProfile = {
      displayName: (user.displayName || 'プレイヤー').slice(0, 12),
      selectedIcon: null,
      selectedTitle: null,
    };
    await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
    return profile;
  } catch (e) {
    console.warn('ユーザープロフィールの取得/作成に失敗（プレイは続行できます）:', e);
    return null;
  }
}

/**
 * 表示名を保存する（ルーム作成/参加時に入力欄の名前が変わっていたら呼ぶ）。
 * 失敗しても無視（次回もFirestore上の旧名がプリフィルされるだけ）。
 */
export async function saveDisplayName(uid: string, name: string): Promise<void> {
  try {
    await updateDoc(doc(firestore, 'users', uid), { displayName: name.slice(0, 12) });
  } catch (e) {
    console.warn('表示名の保存に失敗:', e);
  }
}
