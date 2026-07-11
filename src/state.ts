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

/** ランダムな短いUID生成 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** ランダムな4文字ルームID生成 */
export function newRoomId(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}