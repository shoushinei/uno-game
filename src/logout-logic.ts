// ========================================
// ログアウト／アカウント切替の純粋ロジック（Firebase・DOM 非依存・vitest 対象）
//
// bug-report-logic.ts / friends-util.ts と同じ分離パターン。
// signOut など Firebase を触る部分は auth.ts、判定・文言・
// 「端末から何を消して何を残すか」の一覧はこちらに置く。
// ★Firebase を直 import するファイルは vitest で読めない★ ため、
//   ここには import を一切書かないこと。
// ========================================

/** アカウントの種類（ログイン手段）。表示と警告文の出し分けに使う */
export type AccountKind = 'google' | 'email' | 'guest';

/** 「ログアウト」なのか「別のアカウントに乗り換える」のか */
export type LogoutIntent = 'logout' | 'switch';

/** 今いるルームの状態。どこのルームにも居なければ null */
export type RoomState = 'lobby' | 'playing' | 'ended' | null;

// ----------------------------------------
// アカウントの種類
// ----------------------------------------

/**
 * Firebase の user から種類を求める。
 * メールリンク認証のユーザーは providerId が 'password' になる
 * （EmailAuthProvider.PROVIDER_ID。リンク方式もこの provider の一種）。
 */
export function accountKind(
  user: { isAnonymous?: boolean; providerIds?: string[] } | null
): AccountKind {
  if (!user || user.isAnonymous) return 'guest';
  const ids = user.providerIds ?? [];
  if (ids.includes('google.com')) return 'google';
  if (ids.includes('password') || ids.includes('emailLink')) return 'email';
  // provider が読めない場合はアカウントあり側に倒す（ゲスト扱いにして
  // 「戻れません」と脅すより無難）
  return 'email';
}

/** アカウント種類の日本語ラベル（アカウントメニューの見出しに出す） */
export function accountKindLabel(kind: AccountKind): string {
  return kind === 'google' ? 'Googleアカウント'
       : kind === 'email'  ? 'メールアドレスのアカウント'
       : 'ゲスト（アカウントなし）';
}

// ----------------------------------------
// 端末に残すもの／消すもの
//
// ★規則★ 「アカウントの持ち物」は消し、「この端末の設定」は残す。
// 効果音を切っていた人がログアウトしたら音が復活する、のようなことは
// 起きてほしくない。
// ----------------------------------------

/** ログアウト時に localStorage から消すキー */
export const LOGOUT_CLEAR_KEYS: readonly string[] = [
  // セッション復帰の鍵。席は退室処理で片付けた後なので復帰させる意味がなく、
  // 残すと次のアカウントのログイン時に復帰判定が走って紛らわしい
  'savedRoomId',
  'savedMyId',
  'savedMyName',
  'savedIsHost',
  // メールリンクログインの照合用。前の人のメールアドレスを端末に残さない
  'emailForSignIn',
];

/**
 * ログアウトしても消さないキー（この端末の設定）。
 * ★`seenAchv:{uid}` はキーに uid が入っている＝アカウント別なので残す★
 *   （消すと同じアカウントで戻ったときに実績トーストが全部出直す）
 */
export const KEEP_KEYS: readonly string[] = [
  'pcgSoundOff',        // 効果音 ON/OFF
  'pcgHapticOff',       // 触覚 ON/OFF
  'pcgReactionsOff',    // 対人リアクションの受信 OFF
  'pcgBlockedReactors', // 個別ブロック
  'pcgDrawerOpen',      // PC の引き出しパネル開閉
  'pcgDrawerTab',       // 同・選択中のタブ
];

// ----------------------------------------
// 確認ダイアログの文言
// ----------------------------------------

export interface LogoutPlan {
  /** ログアウト前にルームから退室する必要があるか */
  needsLeave: boolean;
  /** window.confirm に出す文言（これ1回だけ確認する） */
  confirmText: string;
}

/**
 * ログアウト／切替の実行計画を立てる。
 *
 * ★確認は1回だけにする★ ルームに居るときは leaveGame 側にも確認が
 * あるが、二重に出すと「2回OKを押す」ことになるので、こちらで事情を
 * 全部説明して1回にまとめ、退室は確認なしで実行する。
 */
export function planLogout(opts: {
  kind: AccountKind;
  roomState: RoomState;
  intent: LogoutIntent;
}): LogoutPlan {
  const { kind, roomState, intent } = opts;
  const needsLeave = roomState !== null;

  const lines: string[] = [];

  // ルームに居るなら、まず席がどうなるかを伝える
  if (roomState === 'playing') {
    lines.push('ゲームの途中です。退室すると、あなたの手番はボットが自動でプレイします。');
  } else if (roomState === 'lobby') {
    lines.push('参加中のロビーから退室します。');
  } else if (roomState === 'ended') {
    lines.push('参加中のルームから退室します（再戦には参加できなくなります）。');
  }

  // ゲストは片道であることを必ず言う（匿名アカウントは uid が失われる）
  if (kind === 'guest') {
    lines.push('ゲストのプレイは記録に残らないため、いまのゲストには二度と戻れません。');
  }

  lines.push(
    intent === 'switch'
      ? 'ログアウトして、別のアカウントでログインし直します。'
      : 'ログアウトしてログイン画面に戻ります。'
  );

  return { needsLeave, confirmText: lines.join('\n') + '\n\nよろしいですか？' };
}

// ----------------------------------------
// アカウントメニューの中身（純粋な HTML 生成）
//
// renderProfileHtml / renderStatsSummaryHtml と同じで、DOM に触らず
// 文字列を返すだけにしておく（テストから直接呼べる）。
// ----------------------------------------

/** HTML に埋め込む前に最小限のエスケープをする（表示名は自由入力） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * アカウントメニュー（📱=ボトムシート／🖥=中央モーダル）の本文。
 * 入っているアカウントを示したうえで、切替とログアウトの2択を出す。
 */
export function buildAccountMenuHtml(opts: {
  name: string;
  kind: AccountKind;
  icon: string | null;
  title: string | null;
}): string {
  const { name, kind, icon, title } = opts;
  const isGuest = kind === 'guest';

  const note = isGuest
    ? 'ゲストのままでは戦績・実績・フレンドは使えません。ログインすると記録が残るようになります。'
    : '戦績・実績はアカウントに保存されています。次に同じアカウントでログインすれば元どおりです。';

  const titleRow = title
    ? `<div class="acct-title">${escapeHtml(title)}</div>`
    : '';

  return `
    <div class="acct-who">
      <span class="acct-avatar">${escapeHtml(icon || '👤')}</span>
      <div class="acct-who-text">
        <div class="acct-name">${escapeHtml(name || (isGuest ? 'ゲスト' : 'プレイヤー'))}</div>
        <div class="acct-kind">${accountKindLabel(kind)}</div>
        ${titleRow}
      </div>
    </div>
    <div class="acct-actions">
      <button class="btn" onclick="switchAccount()">🔄 別のアカウントでログイン</button>
      <button class="btn quiet" onclick="logoutAccount()">🚪 ログアウト</button>
    </div>
    <p class="acct-note">${note}</p>
  `;
}
