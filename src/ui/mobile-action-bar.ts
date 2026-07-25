// ========================================
// ★モバイルUI M1★ 下部操作バーの表示同期
//
// 従来UI(#s-game)の操作ボタンは各手札の直下に置かれており、375x640 の実機では
// 常に画面外（上端から723〜990px）に落ちていた。手札が減る終盤でも解消せず、
// 毎ターン下へスクロールしないと操作できない状態だった。
// そこで index.html の #mgame-bar へ集約し、CSS の position:sticky で
// 画面下端に貼り付けている。
//
// バーの中身（各ボタン・色ピッカー）は従来どおり個別に display / class で
// 制御されるため、「1つも出ていない」ときにバーの帯だけが残ってしまう。
// それを防ぐのがこのモジュールの役目。
//
// ui-render と ui-input の双方から呼ぶ必要があり、両者は既に
// ui-render → ui-input の依存があるため、循環を作らないよう独立させてある。
// ========================================

/** バーの中身が空かどうかを判定する（純粋・テスト用に分離） */
export function isBarEmpty(displays: string[]): boolean {
  return displays.every(d => d === 'none');
}

/**
 * 下部操作バーの表示/非表示を、中身の実際の表示状態に合わせて更新する。
 *
 * ★順序が重要★ バー自身が display:none の状態だと子孫の computed display も
 * none になり「常に空」と誤判定して二度と表示されなくなる。
 * 先に .empty を外して実際の状態を測ってから付け直す。
 */
export function syncMobileActionBar(): void {
  const bar = document.getElementById('mgame-bar');
  if (!bar) return;
  bar.classList.remove('empty');
  const displays = Array.from(bar.children).map(el => getComputedStyle(el).display);
  bar.classList.toggle('empty', isBarEmpty(displays));
}
