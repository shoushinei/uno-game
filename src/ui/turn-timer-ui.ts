// ========================================
// ターン持ち時間のカウントダウン表示（従来UI／PC UI／対決）
//
// room.turnDeadline / turnDeadlineKey（通常手番）と duelDeadline /
// duelDeadlineKey（対決）を読み、現在キーと一致するときだけ残り秒数を出す。
// 秒の刻みは app.ts の1秒tickから renderTurnTimers(room) を呼んで更新する
// （全体を再描画せず、対象の要素だけ触る軽い更新）。
//
// 締め切りの生成・強制は absent-runner（ホスト権威）側。ここは表示専用。
// ========================================
import { state } from '../state.js';
import { turnKey, duelKey, remainingSec, deadlineActive } from '../logic/turn-timer.js';
import { currentActorId } from '../logic/duel-logic.js';

/** 残り10秒以下で警告表示に切り替える閾値 */
const WARN_SEC = 10;

function nameOf(room: any, id: string): string {
  return (room?.players ?? []).find((p: any) => p.id === id)?.name ?? 'プレイヤー';
}

/** 1要素ぶんの表示更新（remaining=null は非表示） */
function applyTimer(el: HTMLElement | null, remaining: number | null, mine: boolean, label: string): void {
  if (!el) return;
  if (remaining === null) { el.style.display = 'none'; return; }
  el.style.display = '';
  // 秒数を前に出して視認性を上げる（例: 「⏳ 残り45秒 · あなた🃏」）
  el.textContent = `⏳ 残り${remaining}秒${label ? ' · ' + label : ''}`;
  el.classList.toggle('warn', remaining <= WARN_SEC);
  el.classList.toggle('me', mine);
}

/**
 * 現在の room から3か所のカウントダウンを更新する。
 * sync のたび・1秒tickのたびに呼ぶ（冪等）。
 */
export function renderTurnTimers(room: any): void {
  const now = Date.now();

  // --- 対決の持ち時間 ---
  const duel = room?.duel ?? null;
  const dk = duelKey(duel);
  let duelRemaining: number | null = null;
  let duelMine = false;
  let duelLabel = '';
  if (dk && deadlineActive(dk, room?.duelDeadlineKey)) {
    duelRemaining = remainingSec(room?.duelDeadline, now);
    const actor = currentActorId(duel);
    duelMine = actor === state.myId;
    duelLabel = duelMine ? 'あなた' : nameOf(room, actor);
  }
  // 対決オーバーレイ内の要素（renderDuel が毎sync再構築する箱の中にある）
  applyTimer(document.getElementById('duel-timer'), duelRemaining, duelMine, duelLabel);

  // --- 通常手番の持ち時間（対決中は出さない） ---
  const tk = turnKey(room);
  let remaining: number | null = null;
  let mine = false;
  let label = '';
  if (tk && deadlineActive(tk, room?.turnDeadlineKey)) {
    remaining = remainingSec(room?.turnDeadline, now);
    const g = room.game;
    const actor = g.order[g.ci];
    mine = actor === state.myId;
    const phaseLabel = (g.phase || 'trump') === 'trump' ? '🃏' : '🎴';
    label = (mine ? 'あなた' : nameOf(room, actor)) + phaseLabel;
  }
  applyTimer(document.getElementById('turn-timer-classic'), remaining, mine, label);
  applyTimer(document.getElementById('pcg-turn-timer'), remaining, mine, label);
}
