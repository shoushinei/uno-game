// ========================================
// ★モバイルUI M3★ プレイヤーのシート（②のチップをタップで開く）
//
// PC UIでは席をクリックするとポップアップメニューが出るが、モバイルでは
// 画面上部のチップの近くにメニューを出すと親指が届かない。下から出る
// ボトムシートにして、指の届く場所に選択肢を並べる。
//
// これで従来UI(モバイル)に無かった2つが揃う:
//   - ⚔ ヨット対決の挑戦入口（これまで観戦・被挑戦しかできなかった）
//   - 🍅💋💐 対人リアクション（これまでPC UI限定だった）
//
// 判定・文字列組み立ては純粋関数に分離してある（vitest対象）。
// 送信そのものは既存の window.duelChallenge / window.sendReaction /
// window.showPlayerStats に委譲するので、ロジックの二重実装はしない。
// ========================================
import { canChallenge } from '../logic/duel-logic.js';
import {
  SEAT_REACTION_EMOJIS,
  DIRECTED_COOLDOWN_MS,
  isReactorBlocked,
  toggleReactorBlock,
} from './pc/reaction-menu.js';
import { state } from '../state.js';

declare global {
  interface Window {
    closeMobileSheets: () => void;
  }
}

export interface PlayerSheetInput {
  id: string;
  name: string;
  icon?: string;
  title?: string;
  trumpCount: number;
  unoCount: number;
  isBot: boolean;
  isLeft: boolean;
  /** 上がり済みなら順位（1始まり）、まだなら null */
  finishedRank: number | null;
  canDuel: boolean;
  /** 挑めない理由（ヨットモードのときだけ添える。それ以外は出さない） */
  duelReason: string | null;
  blocked: boolean;
  onCooldown: boolean;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/**
 * シートの中身を組み立てる（純粋）。
 * 「⚔ 挑む」は挑める時だけ押せる形にし、ヨットモードなら押せない理由も見せる
 * （ボタンが消えるだけだと、なぜ使えないのか分からないため）。
 */
export function buildPlayerSheetHtml(i: PlayerSheetInput): string {
  const tag = i.isLeft ? '🚪 退室中' : i.isBot ? '🤖 ボット' : '';
  const status = i.finishedRank !== null
    ? `🏁 ${i.finishedRank}位で上がり`
    : `🃏 ${i.trumpCount}枚 ・ 🎴 ${i.unoCount}枚`;

  const duel = i.canDuel
    ? `<button class="mg-ps-item duel" data-ps="duel">⚔ ヨットで挑む<span class="mg-ps-sub">敗者はUNO4枚</span></button>`
    : i.duelReason
      ? `<button class="mg-ps-item" data-ps="duel" disabled>⚔ ヨットで挑む<span class="mg-ps-sub">${esc(i.duelReason)}</span></button>`
      : '';

  const emojis = SEAT_REACTION_EMOJIS.map(e =>
    `<button class="mg-ps-emoji" data-ps="react" data-emoji="${e}"${i.onCooldown ? ' disabled' : ''}>${e}</button>`
  ).join('');

  return `
    <div class="mg-grab"></div>
    <div class="mg-ps-head">
      <span class="mg-ps-icon">${i.icon ? esc(i.icon) : '👤'}</span>
      <span class="mg-ps-name">${esc(i.name)}</span>
      ${i.title ? `<span class="mg-ps-title">${esc(i.title)}</span>` : ''}
      ${tag ? `<span class="mg-ps-tag">${tag}</span>` : ''}
    </div>
    <div class="mg-ps-status">${status}</div>
    ${duel}
    <button class="mg-ps-item" data-ps="stats">📊 戦績を見る</button>
    <div class="mg-sheet-label">投げる${i.onCooldown ? '（少し待ってね）' : ''}</div>
    <div class="mg-ps-emojis">${emojis}</div>
    <button class="mg-ps-item${i.blocked ? ' on' : ''}" data-ps="block">
      ${i.blocked ? '🚫 ブロック中（解除する）' : '🚫 このプレイヤーをブロック'}
    </button>
  `;
}

// ----------------------------------------
// 開閉
// ----------------------------------------
let openTargetId: string | null = null;
let cooldownUntil = 0;

function screenEl(): HTMLElement | null {
  return document.getElementById('s-game');
}

/** room から1人ぶんの表示情報を集める */
function collect(room: any, playerId: string): PlayerSheetInput | null {
  const p = (room?.players ?? []).find((x: any) => x && x.id === playerId);
  if (!p) return null;
  const g = room?.game ?? {};
  const rankIdx = (g.rankings ?? []).findIndex((r: any) => r.id === playerId);
  const ch = canChallenge(room, state.myId, playerId);
  return {
    id: playerId,
    name: p.name ?? 'プレイヤー',
    icon: p.icon,
    title: p.title,
    trumpCount: (g.trumpHands?.[playerId] ?? []).length,
    unoCount: (g.unoHands?.[playerId] ?? []).length,
    isBot: !!p.isBot,
    isLeft: !!room?.leftPlayers?.[playerId],
    finishedRank: rankIdx === -1 ? null : rankIdx + 1,
    canDuel: ch.ok,
    // ヨットモードでないときは「挑む」自体を出さない（存在しない機能の説明は出さない）
    duelReason: room?.mode === 'yacht' ? (ch.reason ?? null) : null,
    blocked: isReactorBlocked(playerId),
    onCooldown: Date.now() < cooldownUntil,
  };
}

export function openPlayerSheet(playerId: string): void {
  const room = (window as any)._room;
  const info = collect(room, playerId);
  if (!info) return;
  const sheet = document.getElementById('mg-player-sheet');
  const sc = screenEl();
  if (!sheet || !sc) return;
  openTargetId = playerId;
  sheet.innerHTML = buildPlayerSheetHtml(info);
  sheet.scrollTop = 0;
  sc.classList.remove('menu-open');
  sc.classList.add('player-open');
}

export function closePlayerSheet(): void {
  screenEl()?.classList.remove('player-open');
  openTargetId = null;
}

/** 開いたままのシートを今の状態で描き直す（ブロックのトグル後など） */
function refresh(): void {
  if (openTargetId) openPlayerSheet(openTargetId);
}

export function installMobilePlayerSheet(): void {
  window.closeMobileSheets = () => {
    closePlayerSheet();
    screenEl()?.classList.remove('menu-open');
  };

  // ② のチップをタップ → シートを開く
  // （長押しは player-stats-card.ts が戦績カードを開く。長押し直後の click は
  //   あちらが capture 段階で握り潰すので、ここには来ない）
  document.getElementById('opl')?.addEventListener('click', e => {
    const op = (e.target as HTMLElement).closest<HTMLElement>('.op[data-player-id]');
    if (!op) return;
    openPlayerSheet(op.dataset.playerId!);
  });

  // シート内の操作
  document.getElementById('mg-player-sheet')?.addEventListener('click', async e => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-ps]');
    if (!btn || (btn as HTMLButtonElement).disabled) return;
    const target = openTargetId;
    if (!target) return;

    switch (btn.dataset.ps) {
      case 'duel':
        closePlayerSheet();
        await window.duelChallenge(target);
        break;
      case 'stats': {
        const name = (window as any)._room?.players
          ?.find((p: any) => p.id === target)?.name ?? 'プレイヤー';
        closePlayerSheet();
        await window.showPlayerStats(target, name);
        break;
      }
      case 'react': {
        if (Date.now() < cooldownUntil) return;
        cooldownUntil = Date.now() + DIRECTED_COOLDOWN_MS;
        closePlayerSheet();
        await window.sendReaction(btn.dataset.emoji!, target);
        break;
      }
      case 'block':
        toggleReactorBlock(target);
        refresh(); // 開いたまま表示だけ更新する
        break;
    }
  });
}
