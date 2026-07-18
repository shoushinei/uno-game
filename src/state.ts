// ========================================
// アプリ全体の状態管理
// ========================================

export interface AppState {
  myId: string;
  myName: string;
  roomId: string;
  isHost: boolean;
  pendingCardIdx: number | null;
  unsubscribeRoom: (() => void) | null;

  // リアクション送信クールダウン管理
  reactionCooldown: boolean;
  lastSentReaction: string | null;
}

export const state: AppState = {
  myId:           "",
  myName:         "",
  roomId:         "",
  isHost:         false,
  pendingCardIdx: null,
  unsubscribeRoom: null,

  // リアクション送信クールダウン管理
  reactionCooldown: false,
  lastSentReaction: null,
};

// ★Phase 1（アカウント基盤）★ プレイヤーIDは Firebase Auth の uid を
// 使うようになったため、旧ランダムID生成 uid() は廃止した。

/**
 * ゲスト用のランダムな表示名（例: 「ゲスト0427」）。
 * 全ゲストが同名「ゲスト」だと、同じルームに2人目のゲストが参加しようと
 * したとき名前重複チェックで弾かれてしまうため、毎回別の名前にする。
 */
export function randomGuestName(): string {
  return 'ゲスト' + Math.floor(1000 + Math.random() * 9000);
}

/** ランダムな4文字ルームID生成 */
export function newRoomId(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}