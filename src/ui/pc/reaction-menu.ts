// ========================================
// 対人リアクション（席クリックのメニュー＋ブロック管理）
//
// 他プレイヤーの席をクリックすると、そのプレイヤーへ 💦/💋/💐 を投げる
// メニューが開く。🚫ブロックは「そのプレイヤーからの対人リアクションを
// 自分の画面で非表示にする」設定で、localStorage に記憶し送信者には
// 通知しない（受信側クライアントで描画スキップ）。
//
// メニューHTMLは静的レイヤー #pcg-reaction-menu へ流し込み、ボタンは
// data-action を持って table-render のクリック委譲に載せる。
// ここは純粋な文字列生成＋localStorage 入出力だけを担当する
// （DOM配置・イベント処理は table-render 側）。
// ========================================

/** 席クリックメニューで投げられる対人リアクション絵文字 */
export const SEAT_REACTION_EMOJIS = ['💦', '💋', '💐'] as const;

/** 対人リアクションのクールダウン（ミリ秒） */
export const DIRECTED_COOLDOWN_MS = 10000;

const LS_BLOCK_KEY = 'pcgBlockedReactors';

// localStorage はブラウザ専用（vitest の node 環境には無い）ためガードする
function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch { /* 無視 */ }
}

function loadBlocked(): string[] {
  const raw = lsGet(LS_BLOCK_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x: unknown): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveBlocked(ids: string[]): void {
  lsSet(LS_BLOCK_KEY, JSON.stringify(ids));
}

/** playerId からの対人リアクションを自分がブロックしているか */
export function isReactorBlocked(playerId: string): boolean {
  return loadBlocked().includes(playerId);
}

/** playerId のブロック状態をトグルし、トグル後の状態（true=ブロック中）を返す */
export function toggleReactorBlock(playerId: string): boolean {
  const ids = loadBlocked();
  const idx = ids.indexOf(playerId);
  if (idx === -1) {
    ids.push(playerId);
    saveBlocked(ids);
    return true;
  }
  ids.splice(idx, 1);
  saveBlocked(ids);
  return false;
}

/**
 * メニュー本体のHTML（絵文字ボタン＋ブロックトグル）。
 * クールダウン中は絵文字ボタンを無効化して理由を添える。
 */
export function renderReactionMenuHtml(
  targetId: string,
  targetName: string,
  blocked: boolean,
  onCooldown: boolean
): string {
  const emojiBtns = SEAT_REACTION_EMOJIS.map(e =>
    `<button class="pcg-rm-emoji${onCooldown ? ' off' : ''}" data-action="react-emoji" data-emoji="${e}" data-target="${targetId}"${onCooldown ? ' disabled' : ''}>${e}</button>`
  ).join('');
  const note = onCooldown
    ? '<div class="pcg-rm-note">クールダウン中…少し待ってね</div>'
    : '';
  const blockBtn =
    `<button class="pcg-rm-block${blocked ? ' on' : ''}" data-action="react-block" data-target="${targetId}">` +
    `${blocked ? '🚫 ブロック中（解除）' : '🚫 このプレイヤーをブロック'}</button>`;
  return `
    <div class="pcg-rm-card">
      <div class="pcg-rm-title">${targetName} へ</div>
      <div class="pcg-rm-emojis">${emojiBtns}</div>
      ${note}
      <div class="pcg-rm-foot">${blockBtn}</div>
    </div>
  `;
}
