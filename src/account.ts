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
  onSnapshot,
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

// ----------------------------------------
// 戦績（Phase 2）
// ----------------------------------------

/** Cloud Functions が書き込む users/{uid}.stats の形（functions/src/stats-logic.ts と対応） */
export interface UserStats {
  games: number;
  wins: number;
  winStreak: number;
  loseStreak: number;
  recent: { rank: number; playerCount: number; at: number }[];
}

/** プロフィール画面が使うユーザードキュメントの読み取り形 */
export interface ProfileData {
  displayName: string | null;
  stats: UserStats | null;
  achievements: Record<string, number> | null;
  reactedFirstAt: number | null;
}

/**
 * プロフィール画面用に表示名・戦績・実績を取得する。
 * ドキュメントが無い・失敗時は null（画面側で「記録なし」表示）。
 */
export async function fetchProfileStats(uid: string): Promise<ProfileData | null> {
  try {
    const snap = await getDoc(doc(firestore, 'users', uid));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      displayName: typeof d.displayName === 'string' ? d.displayName : null,
      stats: d.stats ?? null,
      achievements: d.achievements ?? null,
      reactedFirstAt: typeof d.reactedFirstAt === 'number' ? d.reactedFirstAt : null,
    };
  } catch (e) {
    console.warn('戦績の取得に失敗:', e);
    return null;
  }
}

// ----------------------------------------
// 実績（Phase 3）
// ----------------------------------------

/**
 * 対人リアクション初送信の実績（reaction-first）を立てる。
 * サーバー判定ではなくクライアント記録（合意済みの唯一の例外）。
 * 既に立っていれば何もしない。失敗は無視。
 */
export async function markReactionFirst(uid: string): Promise<void> {
  try {
    const ref = doc(firestore, 'users', uid);
    const snap = await getDoc(ref);
    if (snap.exists() && typeof snap.data().reactedFirstAt === 'number') return; // 既に解除済み
    await setDoc(ref, { reactedFirstAt: Date.now() }, { merge: true });
  } catch (e) {
    console.warn('reaction-first 実績の記録に失敗:', e);
  }
}

/**
 * ユーザードキュメントの変化を購読する（実績解除トースト用）。
 * コールバックには achievements マップと reactedFirstAt を渡す。
 * 返り値の unsubscribe を呼ぶまで購読を続ける。失敗時は no-op を返す。
 */
export function listenUserAchievements(
  uid: string,
  cb: (data: { achievements: Record<string, number>; reactedFirstAt: number | null }) => void
): () => void {
  try {
    return onSnapshot(doc(firestore, 'users', uid), (snap: any) => {
      const d = snap.exists() ? snap.data() : {};
      cb({
        achievements: (d.achievements ?? {}) as Record<string, number>,
        reactedFirstAt: typeof d.reactedFirstAt === 'number' ? d.reactedFirstAt : null,
      });
    }, (e: any) => console.warn('実績購読エラー:', e));
  } catch (e) {
    console.warn('実績購読の開始に失敗:', e);
    return () => {};
  }
}
