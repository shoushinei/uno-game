// ========================================
// 引き出しパネル（画面右端・押し出し式）
//
// - 閉時: 「←」矢印だけの細い帯（未読バッジは付けない）
// - 開時: 「ログ」「ルール」の2タブを持つパネル。矢印は「→」になる
// - 開閉状態とタブ選択は localStorage に記憶（次のゲームでも維持）
// - サーバー上の room.log は直近8件しか保持しないため、ログタブは
//   クライアント側で受信したログを蓄積して長い履歴を表示する
// ========================================

import { areReactionsOff } from './reaction-menu.js';
import { isSoundOn } from '../../audio/audio-engine.js';
// ルールの早見表はモバイルの☰メニューとも共有する（UI非依存なので外に出した）
import { buildRulesSummaryHtml } from '../rules-summary.js';

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

/** 引き出しを強制的に開く（上部バッジのルールジャンプ用） */
export function openDrawer(): void {
  if (!open) toggleDrawer();
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

  const body = tab === 'log' ? _logTabHtml(g) : buildRulesSummaryHtml(g);
  // タブに依らず常時表示する設定フッター（効果音ON/OFF＋全リアクション表示ON/OFF＋バグ報告）
  const off = areReactionsOff();
  const soundOn = isSoundOn();
  const footHtml = `
    <div class="pcg-drawer-foot">
      <button class="pcg-drawer-setting${soundOn ? '' : ' off'}" data-action="sound-toggle">
        ${soundOn ? '🔊 効果音 ON' : '🔇 効果音 OFF'}
      </button>
      <button class="pcg-drawer-setting${off ? ' off' : ''}" data-action="reactions-toggle">
        ${off ? '🔕 リアクション非表示中' : '🔔 リアクション表示中'}
      </button>
      <button class="pcg-drawer-setting" data-action="bug-report">🐛 バグを報告</button>
    </div>
  `;
  return `${tabsHtml}<div class="pcg-drawer-body">${body}</div>${footHtml}`;
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


