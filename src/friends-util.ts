// ========================================
// フレンド機能の純粋ヘルパー（Firebase非依存・テスト対象）
// friends.ts から利用する。ここは Firestore を import しないので
// node環境の vitest からそのまま読める。
// ========================================

/** 2人のuidからペアの一意ID（順不同で同じになる）を作る */
export function pairId(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/** 紛らわしい文字を除いた英数字で6桁のフレンドコードを作る */
export function generateCode(rand: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I を除外
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(rand() * chars.length)];
  return c;
}
