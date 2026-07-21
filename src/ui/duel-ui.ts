// ========================================
// ヨット対決のオーバーレイUI（Step 2）
//
// room.duel の同期を受けて全画面オーバーレイ（#duel-overlay・body直下）を
// 描画する。PC UI・従来UIのどちらでも同じオーバーレイが出る。
// 対決中はこのオーバーレイが盤面を覆うため、通常のゲーム操作は自然に
// できなくなる（ボット類は _duelActive フラグで別途停止）。
//
// - 手番側: サイコロをクリックして「残す」をトグル → 🎲振る / ✅確定
// - 相手・観戦者: 進行を眺める（リアクションは対局画面同様に飛ぶ）
// - 決着後: 勝敗表示 → 当事者が「ゲームに戻る」で duel を閉じる
// ========================================
import { state } from '../state.js';
import {
  actionYachtChallenge, actionYachtRoll, actionYachtCommit, actionYachtClose,
} from '../actions/yacht-actions.js';
import { currentActorId, type DuelState, type DuelSide } from '../logic/duel-logic.js';
import { MAX_ROLLS, DICE_COUNT } from '../logic/yacht-logic.js';

declare global {
  interface Window {
    duelChallenge: (targetId: string) => Promise<void>;
    duelToggleKeep: (i: number) => void;
    duelRoll: () => Promise<void>;
    duelCommit: () => Promise<void>;
    duelClose: () => Promise<void>;
    _duelActive?: boolean;
  }
}

/** 役IDの表示名 */
const CATEGORY_NAMES: Record<string, string> = {
  'yacht': 'ヨット', 'big-straight': 'ビッグストレート', 'small-straight': 'スモールストレート',
  'full-house': 'フルハウス', 'four-numbers': 'フォーナンバーズ', 'choice': 'チョイス',
  '1': '1の目', '2': '2の目', '3': '3の目', '4': '4の目', '5': '5の目', '6': '6の目',
};
const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** 残す目の選択（ローカル状態・手番が切り替わったらリセット） */
let keep = new Set<number>();
let keepKey = '';
/** 連打防止 */
let busy = false;

let lastNames: Record<string, string> = {};

/** ★Step 4★ 演出用: 前回描画時の各側のサイコロ（振られた目だけ転がすため） */
let prevDice: { attacker: number[]; defender: number[] } = { attacker: [], defender: [] };

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

window.duelChallenge = async (targetId) => {
  const r = await actionYachtChallenge(targetId);
  if (r.error) console.warn('挑戦失敗:', r.error);
};
window.duelToggleKeep = (i) => {
  if (keep.has(i)) keep.delete(i); else keep.add(i);
  // 再描画は次の同期を待たずローカルで即時反映
  const btn = document.querySelector(`#duel-overlay .duel-die[data-i="${i}"]`);
  btn?.classList.toggle('keep', keep.has(i));
};
window.duelRoll = async () => {
  if (busy) return; busy = true;
  try {
    const flags = Array.from({ length: DICE_COUNT }, (_, i) => keep.has(i));
    await actionYachtRoll(keep.size > 0 ? flags : null);
  } finally { busy = false; }
};
window.duelCommit = async () => {
  if (busy) return; busy = true;
  try { await actionYachtCommit(); } finally { busy = false; }
};
window.duelClose = async () => {
  if (busy) return; busy = true;
  try { await actionYachtClose(); } finally { busy = false; }
};

function diceRow(side: DuelSide, clickable: boolean, prev: number[]): string {
  const dice = Array.isArray(side.dice) ? side.dice : [];
  if (dice.length === 0) {
    return `<div class="duel-dice empty">${'🎲'.repeat(DICE_COUNT)}</div>`;
  }
  const animate = !reducedMotion();
  return `<div class="duel-dice">${dice.map((d, i) => {
    // ★Step 4★ 前回と目が変わった＝今振られたサイコロだけ転がす（残した目は静止）
    const rolled = animate && prev[i] !== d;
    return `<button class="duel-die${clickable ? ' clickable' : ''}${clickable && keep.has(i) ? ' keep' : ''}${rolled ? ' just-rolled' : ''}"
      data-i="${i}" ${clickable ? `onclick="duelToggleKeep(${i})"` : 'disabled'}>${DICE_FACES[d - 1] ?? '?'}</button>`;
  }).join('')}</div>`;
}

function sidePanel(duel: DuelState, who: 'attacker' | 'defender'): string {
  const side = (who === 'attacker' ? duel.attacker : duel.defender) ?? { dice: [], rollsLeft: MAX_ROLLS, done: false, best: null };
  const uid = who === 'attacker' ? duel.attackerId : duel.defenderId;
  const name = lastNames[uid] ?? '?';
  const isTurn = duel.stage === 'rolling' && duel.turn === who;
  const isMe = uid === state.myId;
  const clickable = isTurn && isMe && (side.dice?.length ?? 0) > 0;
  const rolls = typeof side.rollsLeft === 'number' ? side.rollsLeft : MAX_ROLLS;

  // ★Step 4★ 決着後は勝者/敗者で見た目を変える
  let outcome = '';
  if (duel.stage === 'done') {
    if (duel.result === 'draw') outcome = ' draw';
    else if (duel.winnerId === uid) outcome = ' winner';
    else outcome = ' loser';
  }
  // 高得点役（30点以上）は役名を発光させる
  const bigHand = (side.best?.score ?? 0) >= 30;

  const status = side.done && side.best
    ? `<div class="duel-best${bigHand ? ' big' : ''}">${CATEGORY_NAMES[side.best.category] ?? side.best.category}<b>${side.best.score}点</b></div>`
    : isTurn
    ? `<div class="duel-status">${isMe ? 'あなたの番！' : '振っています…'}（残り${rolls}回振れる）</div>`
    : `<div class="duel-status wait">待機中</div>`;

  return `
    <div class="duel-side${isTurn ? ' active' : ''}${outcome}">
      ${outcome === ' winner' ? '<div class="duel-crown">👑</div>' : ''}
      <div class="duel-side-name">${who === 'attacker' ? '⚔' : '🛡'} ${name}${isMe ? '（あなた）' : ''}</div>
      ${diceRow(side, clickable, prevDice[who])}
      ${status}
    </div>`;
}

/** 自分が手番側のときの操作ボタン */
function controls(duel: DuelState): string {
  if (duel.stage !== 'rolling' || currentActorId(duel) !== state.myId) return '';
  const side = duel.turn === 'attacker' ? duel.attacker : duel.defender;
  const rolls = typeof side?.rollsLeft === 'number' ? side.rollsLeft : MAX_ROLLS;
  const hasDice = (side?.dice?.length ?? 0) > 0;
  return `
    <div class="duel-controls">
      ${rolls > 0 ? `<button class="duel-btn roll" onclick="duelRoll()">🎲 ${hasDice ? '選んだ目以外を振り直す' : 'サイコロを振る'}（残り${rolls}回）</button>` : ''}
      ${hasDice ? `<button class="duel-btn commit" onclick="duelCommit()">✅ この手で確定</button>` : ''}
      ${hasDice && rolls > 0 ? '<p class="duel-hint">残したい目をクリックで選択（金枠＝残す）</p>' : ''}
    </div>`;
}

function resultBanner(duel: DuelState): string {
  if (duel.stage !== 'done') return '';
  const isParty = state.myId === duel.attackerId || state.myId === duel.defenderId;
  const text = duel.result === 'draw'
    ? '🤝 引き分け！（誰もカードを引かない）'
    : `🏆 ${lastNames[duel.winnerId!] ?? '?'} の勝ち！`;
  // ★Step 3★ 敗者へのペナルティ予告（実際のドローは「ゲームに戻る」で適用）
  const loserId = duel.result === 'attacker' ? duel.defenderId
    : duel.result === 'defender' ? duel.attackerId : null;
  const penalty = loserId
    ? `<div class="duel-penalty">💥 ${lastNames[loserId] ?? '?'} はUNOを4枚引く！</div>`
    : '';
  return `
    <div class="duel-finish${reducedMotion() ? '' : ' pop'}">
      <div class="duel-result">${text}</div>
      ${penalty}
      ${isParty ? '<button class="duel-btn close" onclick="duelClose()">ゲームに戻る</button>'
                : '<p class="duel-hint">当事者が閉じるのを待っています…</p>'}
    </div>`;
}

/** 現在の startedAt（対決の切り替わり検出用）。演出のprevDiceリセットに使う */
let prevStartedAt = 0;

/** room 同期のたびに呼ばれる（app.ts のリスナーから） */
export function renderDuel(room: any): void {
  const overlay = document.getElementById('duel-overlay');
  if (!overlay) return;
  const duel: DuelState | null = room?.duel ?? null;
  window._duelActive = !!duel;
  if (!duel) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    keep.clear(); keepKey = '';
    prevDice = { attacker: [], defender: [] };
    prevStartedAt = 0;
    return;
  }
  // 手番の切り替わり（or 新しい対決）で「残す」選択をリセット
  const key = `${duel.startedAt}:${duel.turn}`;
  if (key !== keepKey) { keep.clear(); keepKey = key; }
  // ★Step 4★ 別の対決に切り替わったら転がり演出の基準をリセット
  if (duel.startedAt !== prevStartedAt) {
    prevDice = { attacker: [], defender: [] };
    prevStartedAt = duel.startedAt;
  }

  lastNames = Object.fromEntries((room.players ?? []).map((p: any) => [p.id, p.name]));
  const wasOpen = overlay.style.display === 'flex';
  overlay.style.display = 'flex';
  overlay.classList.toggle('opening', !wasOpen && !reducedMotion());
  overlay.innerHTML = `
    <div class="duel-box">
      <div class="duel-title">🎲 ヨット対決 — 最高の役で勝負！（敗者はUNOを4枚引く）</div>
      <div class="duel-sides">
        ${sidePanel(duel, 'attacker')}
        <div class="duel-vs">VS</div>
        ${sidePanel(duel, 'defender')}
      </div>
      ${controls(duel)}
      ${resultBanner(duel)}
    </div>`;

  // 次回の「振られた目」検出のため、今回の目を記録する
  prevDice = {
    attacker: Array.isArray(duel.attacker?.dice) ? [...duel.attacker.dice] : [],
    defender: Array.isArray(duel.defender?.dice) ? [...duel.defender.dice] : [],
  };
}
