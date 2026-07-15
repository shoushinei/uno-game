// ========================================
// PC向け新UIと従来UIの切り替え判定
//
// ★バグ修正★ 以前は window.matchMedia の結果を毎回（Firebase同期のたびに）
// 再評価していたため、ブラウザ幅が判定境界付近（devtoolsの開閉・プレビュー
// ペインのリサイズ等）にあると、ゲームの途中で黙ってPC UI⇄従来UIが
// 切り替わってしまっていた。show()（どの画面をactiveにするか）と
// renderGame()（どちらの描画関数を呼ぶか）が食い違うと、「実際に表示されて
// いる画面」と「更新されている画面」がズレ、ボタンを押しても反応しない・
// カードが出せなくなる、といった症状の原因になっていた。
//
// 対策:
//   1. 判定を「実機種別（タッチ・モバイルUA）」ベースに変更し、
//      デスクトップブラウザのウィンドウ幅だけでモバイル扱いされないようにする
//   2. 判定結果をページ読み込み時に1回だけ計算してキャッシュする
//      （セッション中は絶対に変わらない。リロードすれば再判定される）
//
// - ?ui=classic を付けるとPCでも従来UIに戻せる（不具合時の逃げ道）
// - ?ui=pc を付けると、狭いプレビュー画面でもPC UIを強制できる（検証用）
// ========================================

function computeIsPcUi(): boolean {
  if (typeof window === 'undefined') return false;

  const uiParam = new URLSearchParams(window.location.search).get('ui');
  if (uiParam === 'classic') return false;
  if (uiParam === 'pc') return true;

  // ---- 実機種別の判定（ウィンドウ幅より優先する） ----
  const ua = navigator.userAgent || '';
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  if (isMobileUA) return false;

  // 「粗いポインタ（指）」かつ「ホバー不可」な端末は、たとえUAで判定できなくても
  // タブレット等とみなして従来UIにする。ノートPCのタッチスクリーンは
  // 通常マウスも使えて hover: hover が真になるため誤判定しない。
  const isTouchOnly =
    window.matchMedia('(pointer: coarse)').matches &&
    !window.matchMedia('(hover: hover)').matches;
  if (isTouchOnly) return false;

  // ---- デスクトップブラウザ: 実用に耐える最低限の幅だけを見る ----
  return window.innerWidth >= 820;
}

let cachedIsPcUi: boolean | null = null;

export function isPcUi(): boolean {
  if (cachedIsPcUi === null) cachedIsPcUi = computeIsPcUi();
  return cachedIsPcUi;
}
