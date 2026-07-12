// ========================================
// 操作バー
//
// 画面下の1本のバーが状況に応じて「モード」を切り替え、
// すべての操作（出す/パス/引く/UNO宣言/ワイルド色選択/親の色変更）が
// ここで完結する。モーダルは使わない。
//
// モード導出（deriveBarState）はDOM非依存の純粋関数としてテスト対象にする。
// ========================================
import { trumpCanPlay, type TrumpCard } from '../../logic/trump-logic.js';
import type { Player } from '../../logic/types';

export type BarMode =
  | 'waiting'        // 他プレイヤーの手番
  | 'spectator'      // 自分は上がり済み（観戦）
  | 'trump'          // 自分のトランプ手番
  | 'trump-skip'     // 自分のトランプ手番だが手札0枚（スキップのみ）
  | 'uno'            // 自分のUNO手番
  | 'uno-skip'       // 自分のUNO手番だが手札0枚（スキップのみ）
  | 'wild-color'     // ワイルドを出した直後の色選択
  | 'parent-color';  // 親の権限の色選択

export interface BarUiState {
  selectedTrumpIds: string[];
  selectedUnoIdx: number | null;
  pendingUnoIdx: number | null;
  /** 'wild-color' | 'parent-color' | null。バー描画側が保持する一時状態 */
  override: 'wild-color' | 'parent-color' | null;
}

export interface BarState {
  mode: BarMode;
  /** UNO宣言ボタンを出すか（残り2枚＋カード選択中＋未宣言） */
  showDeclare: boolean;
  /** 親の権限（👑色を変更）ボタンを出すか */
  showParentButton: boolean;
  /** 「出す」を押せるか */
  canSubmit: boolean;
  /** ペナルティ累積枚数（0なら通常ドロー） */
  penaltyCount: number;
  /** 手番プレイヤー名（waiting時の表示用） */
  curName: string;
}

/**
 * ゲーム状態とUI状態から操作バーのモードを導出する（純粋関数）。
 */
export function deriveBarState(g: any, myId: string, ui: BarUiState, players: Player[]): BarState {
  const curId = g.order?.[g.ci];
  const isMyTurn = curId === myId;
  const phase = g.phase || 'trump';
  const finished = (g.rankings || []).some((r: { id: string }) => r.id === myId);

  const myTrump: TrumpCard[] = (g.trumpHands && g.trumpHands[myId]) || [];
  const myUno: any[] = (g.unoHands && g.unoHands[myId]) || [];
  const isParentNow = isMyTurn && phase === 'uno' && g.hasParent === myId && !finished;
  const saidUno = !!(g.unoSaid && g.unoSaid[myId]);

  const base: BarState = {
    mode: 'waiting',
    showDeclare: false,
    showParentButton: false,
    canSubmit: false,
    penaltyCount: g.unoPenaltyAccum || 0,
    curName: players.find(p => p.id === curId)?.name ?? '?',
  };

  if (finished) return { ...base, mode: 'spectator' };
  if (!isMyTurn) return base;

  // ---- 一時モード（色選択）。前提が崩れていたら無効として通常モードへ ----
  if (ui.override === 'wild-color' && phase === 'uno' && ui.pendingUnoIdx !== null) {
    return { ...base, mode: 'wild-color' };
  }
  if (ui.override === 'parent-color' && isParentNow) {
    return { ...base, mode: 'parent-color' };
  }

  if (phase === 'trump') {
    if (myTrump.length === 0) return { ...base, mode: 'trump-skip' };
    const selectedCards = ui.selectedTrumpIds
      .map(id => myTrump.find(c => c.id === id))
      .filter((c): c is TrumpCard => Boolean(c));
    const canSubmit =
      selectedCards.length > 0 &&
      trumpCanPlay(selectedCards, Array.isArray(g.trumpField) ? g.trumpField : [], g);
    return { ...base, mode: 'trump', canSubmit };
  }

  // phase === 'uno'
  if (myUno.length === 0) {
    return { ...base, mode: 'uno-skip', showParentButton: isParentNow };
  }
  return {
    ...base,
    mode: 'uno',
    canSubmit: ui.selectedUnoIdx !== null,
    showParentButton: isParentNow,
    showDeclare: shouldShowUnoDeclare(myUno.length, ui.selectedUnoIdx, saidUno),
  };
}

/**
 * UNO宣言ボタンの出現条件（純粋関数）。
 *
 * 宣言が意味を持つのは「残り2枚から1枚になるカードを出す」ときだけなので、
 * 「残り2枚 ＋ カードを選択中 ＋ 未宣言」の間だけ表示する。
 * （以前の「2枚以下なら常に表示」は、出せないのに宣言できる等の違和感があった）
 */
export function shouldShowUnoDeclare(unoHandLength: number, selectedIdx: number | null, saidUno: boolean): boolean {
  return unoHandLength === 2 && selectedIdx !== null && !saidUno;
}

// ----------------------------------------
// バーのHTML生成
// ----------------------------------------
const COLOR_BUTTONS = (action: string): string => `
  <button class="pcg-color-btn pcg-cb-red" data-action="${action}" data-color="red" aria-label="赤"></button>
  <button class="pcg-color-btn pcg-cb-blue" data-action="${action}" data-color="blue" aria-label="青"></button>
  <button class="pcg-color-btn pcg-cb-green" data-action="${action}" data-color="green" aria-label="緑"></button>
  <button class="pcg-color-btn pcg-cb-yellow" data-action="${action}" data-color="yellow" aria-label="黄"></button>
`;

const REACTION_EMOJIS = ['😭', '💢', '😂', '👏', '❤️', '🔥'];

export function renderActionBarHtml(bar: BarState, reactionOpen: boolean, autoAdvancing = false): string {
  const reactionBtn = `<span class="pcg-bar-sep">|</span>
    <button class="pcg-btn" data-action="reaction-toggle">😄</button>`;
  const reactionStrip = reactionOpen
    ? `<div class="pcg-reaction-strip">${REACTION_EMOJIS.map(e =>
        `<button class="pcg-react-btn" data-action="reaction" data-emoji="${e}">${e}</button>`
      ).join('')}</div>`
    : '';

  let inner = '';
  switch (bar.mode) {
    case 'spectator':
      inner = `<span class="pcg-bar-note">🏁 上がり（観戦中）</span>${reactionBtn}`;
      break;
    case 'waiting':
      inner = `<span class="pcg-bar-note">${bar.curName} のターンを待っています…</span>${reactionBtn}`;
      break;
    case 'trump':
      inner = `
        <button class="pcg-btn pcg-btn-primary" data-action="trump-play" ${bar.canSubmit ? '' : 'disabled'}>出す</button>
        <button class="pcg-btn" data-action="trump-pass">パス</button>
        ${reactionBtn}`;
      break;
    case 'trump-skip':
      // 通常は自動進行（ボタン不要）。自動発火が滞ったときだけ手動ボタンを出す
      inner = autoAdvancing
        ? `<span class="pcg-bar-note pcg-note-auto">✅ トランプ出し切り — 自動でUNOフェイズへ進みます…</span>`
        : `
        <span class="pcg-bar-note">✅ トランプ出し切り</span>
        <button class="pcg-btn pcg-btn-primary" data-action="trump-skip">UNOフェイズへ ▶</button>
        ${reactionBtn}`;
      break;
    case 'uno':
      inner = `
        ${bar.showDeclare ? '<button class="pcg-btn pcg-btn-declare" data-action="say-uno">📢 UNO宣言！</button>' : ''}
        <button class="pcg-btn pcg-btn-primary" data-action="uno-play" ${bar.canSubmit ? '' : 'disabled'}>出す</button>
        <button class="pcg-btn" data-action="uno-draw">${bar.penaltyCount > 0 ? `ペナルティ ${bar.penaltyCount} 枚引く` : '1枚引く'}</button>
        ${bar.showParentButton ? '<button class="pcg-btn pcg-btn-parent" data-action="parent-open">👑 色を変更</button>' : ''}
        ${reactionBtn}`;
      break;
    case 'uno-skip':
      // 通常は自動進行。ただし親の権限を持つ間は自動発火しない
      // （auto-advance側の判定）ため、その場合はここのボタンが出る
      inner = autoAdvancing
        ? `<span class="pcg-bar-note pcg-note-auto">✅ UNO出し切り — 自動で次のプレイヤーへ進みます…</span>`
        : `
        <span class="pcg-bar-note">✅ UNO出し切り</span>
        <button class="pcg-btn pcg-btn-primary" data-action="uno-skip">次のトランプフェイズへ ▶</button>
        ${bar.showParentButton ? '<button class="pcg-btn pcg-btn-parent" data-action="parent-open">👑 色を変更</button>' : ''}
        ${reactionBtn}`;
      break;
    case 'wild-color':
      inner = `
        <span class="pcg-bar-note">色を選んでください:</span>
        ${COLOR_BUTTONS('wild-color')}
        <button class="pcg-btn" data-action="wild-cancel">キャンセル</button>`;
      break;
    case 'parent-color':
      inner = `
        <span class="pcg-bar-note pcg-note-parent">👑 親の権限:</span>
        ${COLOR_BUTTONS('parent-color')}
        <button class="pcg-btn" data-action="parent-cancel">使わない</button>`;
      break;
  }

  return `${reactionStrip}<div class="pcg-bar">${inner}</div>`;
}
