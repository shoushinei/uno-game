// ========================================
// アプリ全体の状態管理
// ========================================

export const state = {
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
export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** ランダムな4文字ルームID生成 */
export function newRoomId() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
