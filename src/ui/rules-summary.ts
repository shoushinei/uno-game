// ========================================
// ルールの早見表（対戦中に開くもの）
//
// ★これが「対戦中のルール」の唯一の実装★
// もともとPC UIの引き出し（drawer.ts）の中にだけ書かれていたため、
// モバイルはゲーム中にルールを確認する手段が無かった（☰メニューにも
// 無く、PCの引き出しにしか存在しなかった）。UI非依存なのでここへ出し、
// PCの引き出しとモバイルの☰メニューが同じものを表示する。
//
// index.html の #rule-modal（全文のルール説明）とは役割が違う:
//   このファイル … 対戦中にちらっと見る早見表＋★いま発動中の状態★
//   #rule-modal  … 初めての人がホーム/ロビーで読む全文（184行）
// 片方に寄せると、早見表が長すぎるか全文が足りないかになるので分けている。
//
// クラス名は `pcg-rule-*` のまま（PC引き出しのスタイルをそのまま使う）。
// モバイル側は明るいシートの上に出すので game.css が別途色を当てている。
// ========================================
import { countUnoActivePlayers } from '../logic/uno-logic.js';

/**
 * 早見表のHTMLを組み立てる。
 *
 * 先頭に「今この瞬間に発動している状態」を置く。ここのidは、PC UIの
 * 上部バッジから該当説明へジャンプする（rule-jump）ときの目印にも使う。
 *
 * @param g ゲーム状態。ロビー等でまだ無い場合は null/undefined でよい
 */
export function buildRulesSummaryHtml(g: any): string {
  const active: string[] = [];
  if (g?.trumpRevolution) active.push('<div class="pcg-rule-active" id="pcg-rule-rev">🌀 <b>革命中</b> — カードの強さが全て逆転しています（3が最強側）</div>');
  if (g?.trumpElevenBack) active.push('<div class="pcg-rule-active" id="pcg-rule-jback">🔄 <b>Jバック中</b> — この場が流れるまで強さが逆転しています</div>');
  if (Array.isArray(g?.trumpSuitLock) && g.trumpSuitLock.length > 0) {
    active.push(`<div class="pcg-rule-active" id="pcg-rule-lock">⛓ <b>${g.trumpSuitLock.join('')}しばり中</b> — 場が流れるまで同じマークしか出せません</div>`);
  }
  if (g && countUnoActivePlayers(g) === 1) {
    active.push('<div class="pcg-rule-active" id="pcg-rule-solo">🎴 <b>UNO残り1人</b> — 引かせる相手がいないため、+2/+4を出してもドロー効果は発動しません（色変更などは有効）</div>');
  }
  const activeHtml = active.length > 0
    ? active.join('')
    : '<div class="pcg-rule-none">現在発動中の特殊状態はありません</div>';

  return `
    ${activeHtml}
    <div class="pcg-rule-sec">🃏 トランプ（毎ターン①）</div>
    <ul class="pcg-rule-list">
      <li>場より強いカードのみ。同数字の複数枚・階段（同スート3枚以上連番）も可</li>
      <li>強さ: 3＜4＜…＜K＜A＜2＜🃏</li>
      <li><b>✂️8切り</b>・<b>🃏単体</b>・<b>♠3返し</b>・<b>🙌全員パス</b>で場が流れ、流した人が👑親</li>
      <li><b>🌀革命</b>: 4枚以上出しで強さ逆転 ／ <b>🔄Jバック</b>: J入りでその場だけ逆転</li>
      <li><b>⛓しばり</b>: 同マークが続くと発動、そのマーク限定</li>
    </ul>
    <div class="pcg-rule-sec">🎴 UNO（毎ターン②）</div>
    <ul class="pcg-rule-list">
      <li>同じ色 か 同じ数字・記号を1枚。出せなければ1枚引く</li>
      <li>スキップ・リバースは<b>トランプの手番にも波及</b></li>
      <li>+2/+4は同種でのみ返せて累積。返せないとまとめて引く</li>
      <li>UNOの手札を持つのが<b>残り1人</b>になったら、+2/+4のドロー効果は発動しない</li>
      <li>残り2枚から1枚出すとき、出す前に<b>📢UNO宣言</b>（忘れると+2枚）</li>
    </ul>
    <div class="pcg-rule-sec">👑 親の権限</div>
    <ul class="pcg-rule-list">
      <li>自分のUNOフェイズ中に1回だけ、UNOの色を強制変更できる（使わず終えると消滅）</li>
    </ul>
    <div class="pcg-rule-sec">🏁 上がり</div>
    <ul class="pcg-rule-list">
      <li>トランプとUNOの<b>両方</b>を出し切ったら上がり。上がった順が最終順位</li>
    </ul>
  `;
}
