// ========================================
// 引き出しパネル（画面右端・押し出し式）
//
// - 閉時: 「←」矢印だけの細い帯（未読バッジは付けない）
// - 開時: 「ログ」「ルール」の2タブを持つパネル。矢印は「→」になる
// - 開閉状態とタブ選択は localStorage に記憶（次のゲームでも維持）
// - サーバー上の room.log は直近8件しか保持しないため、ログタブは
//   クライアント側で受信したログを蓄積して長い履歴を表示する
// ========================================

const LS_OPEN_KEY = 'pcgDrawerOpen';
const LS_TAB_KEY = 'pcgDrawerTab';
const MAX_LOCAL_LOG = 200;

type DrawerTab = 'log' | 'rules';

// localStorage はブラウザ専用（vitest の node 環境には無い）ためガードする
function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch { /* 無視 */ }
}

let open = lsGet(LS_OPEN_KEY) === '1';
let tab: DrawerTab = lsGet(LS_TAB_KEY) === 'rules' ? 'rules' : 'log';

/** クライアント側で蓄積したログ（サーバーは直近8件しか持たないため） */
let localLog: string[] = [];

export function isDrawerOpen(): boolean {
  return open;
}

export function toggleDrawer(): void {
  open = !open;
  lsSet(LS_OPEN_KEY, open ? '1' : '0');
}

export function setDrawerTab(next: string): void {
  tab = next === 'rules' ? 'rules' : 'log';
  lsSet(LS_TAB_KEY, tab);
}

/** ゲームが切り替わったとき（別ルーム等）にログ蓄積をリセットする */
export function resetDrawerLog(): void {
  localLog = [];
}

/**
 * サーバーの room.log（末尾8件のスライド窓）を、手元の蓄積ログへマージする。
 *
 * サーバー側は追記専用＋末尾8件維持なので、「手元の末尾」と「受信配列の先頭側」の
 * 最大の重なりを探し、重なっていない後半だけを追記する。
 */
export function mergeServerLog(serverLog: string[] | null | undefined): void {
  const incoming = Array.isArray(serverLog) ? serverLog : [];
  if (incoming.length === 0) return;

  // 手元の末尾 k 件と incoming の先頭 k 件が一致する最大の k を探す
  let overlap = 0;
  const maxK = Math.min(localLog.length, incoming.length);
  for (let k = maxK; k >= 1; k--) {
    let match = true;
    for (let i = 0; i < k; i++) {
      if (localLog[localLog.length - k + i] !== incoming[i]) { match = false; break; }
    }
    if (match) { overlap = k; break; }
  }

  for (let i = overlap; i < incoming.length; i++) {
    localLog.push(incoming[i]!);
  }
  if (localLog.length > MAX_LOCAL_LOG) {
    localLog = localLog.slice(-MAX_LOCAL_LOG);
  }
}

// ----------------------------------------
// 描画
// ----------------------------------------
export function renderDrawerHtml(g: any): string {
  if (!open) {
    return `
      <div class="pcg-drawer-strip">
        <button class="pcg-drawer-toggle" data-action="drawer-toggle" aria-label="ログとルールを開く">←</button>
      </div>
    `;
  }

  const tabsHtml = `
    <div class="pcg-drawer-head">
      <button class="pcg-drawer-toggle" data-action="drawer-toggle" aria-label="パネルを閉じる">→</button>
      <button class="pcg-drawer-tab${tab === 'log' ? ' active' : ''}" data-action="drawer-tab" data-tab="log">ログ</button>
      <button class="pcg-drawer-tab${tab === 'rules' ? ' active' : ''}" data-action="drawer-tab" data-tab="rules">ルール</button>
    </div>
  `;

  const body = tab === 'log' ? _logTabHtml(g) : _rulesTabHtml(g);
  return `${tabsHtml}<div class="pcg-drawer-body">${body}</div>`;
}

function _logTabHtml(g: any): string {
  if (localLog.length === 0) return '<div class="pcg-drawer-empty">まだログはありません</div>';
  const lines = localLog.map(l => {
    let cls = '';
    if (l.includes('8切り') || l.includes('ジョーカー') || l.includes('場が流れた') || l.includes('革命')) cls = ' hl-gold';
    else if (l.includes('UNO宣言') || l.includes('UNO忘れ') || l.includes('ペナルティ')) cls = ' hl-red';
    else if (l.includes('上がり')) cls = ' hl-green';
    return `<div class="pcg-log-line${cls}">${l}</div>`;
  }).join('');
  return `<div class="pcg-log-list" id="pcg-log-list">${lines}</div>`;
}

function _rulesTabHtml(g: any): string {
  // 今この瞬間に発動している状態を最上部で強調する
  const active: string[] = [];
  if (g?.trumpRevolution) active.push('<div class="pcg-rule-active">🌀 <b>革命中</b> — カードの強さが全て逆転しています（3が最強側）</div>');
  if (g?.trumpElevenBack) active.push('<div class="pcg-rule-active">🔄 <b>Jバック中</b> — この場が流れるまで強さが逆転しています</div>');
  if (Array.isArray(g?.trumpSuitLock) && g.trumpSuitLock.length > 0) {
    active.push(`<div class="pcg-rule-active">⛓ <b>${g.trumpSuitLock.join('')}しばり中</b> — 場が流れるまで同じマークしか出せません</div>`);
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
