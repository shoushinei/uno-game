// ========================================
// PC向け新UIと従来UIの切り替え判定
//
// - 画面幅 1024px 以上のブラウザでは新しいPC向けゲーム画面（#s-game-pc）を使う
// - URLに ?ui=classic が付いている場合はPCでも従来UI（#s-game）に戻せる
//   （新UIに不具合があったときの逃げ道）
// - モバイル・タブレット（1024px未満）は従来UIのまま
// ========================================

export function isPcUi(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('ui') === 'classic') return false;
  return window.matchMedia('(min-width: 1024px)').matches;
}
