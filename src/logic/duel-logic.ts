// ========================================
// ヨット対決の状態機械（Step 2・純粋ロジック）
//
// room.duel として RTDB に置き、全員に同期される（観戦もこの同期で成立）。
// 攻撃側が先攻で3投すべて終えてから守備側（合意済み仕様）。
// 勝敗は bestHand の点数のみで判定。同点は draw（誰も引かない）。
//
// ★RTDB注意★ 空配列はノードごと消えるため、dice は読み込み時に ?? [] で
// 防御する（このファイルの関数は常に配列を返す）。
// ========================================
import { rollDice, reroll, bestHand, judgeDuel, MAX_ROLLS, DICE_COUNT, type HandScore } from './yacht-logic.js';

export interface DuelSide {
  dice: number[];
  rollsLeft: number;
  done: boolean;
  best: HandScore | null;
}

export interface DuelState {
  attackerId: string;
  defenderId: string;
  /** 今振っている側（attacker が done になったら defender へ） */
  turn: 'attacker' | 'defender';
  stage: 'rolling' | 'done';
  attacker: DuelSide;
  defender: DuelSide;
  result: 'attacker' | 'defender' | 'draw' | null;
  winnerId: string | null;
  startedAt: number;
}

function newSide(): DuelSide {
  return { dice: [], rollsLeft: MAX_ROLLS, done: false, best: null };
}

export function newDuel(attackerId: string, defenderId: string, now: number): DuelState {
  return {
    attackerId, defenderId,
    turn: 'attacker', stage: 'rolling',
    attacker: newSide(), defender: newSide(),
    result: null, winnerId: null, startedAt: now,
  };
}

/** 今サイコロを操作すべきプレイヤーのID */
export function currentActorId(duel: DuelState): string {
  return duel.turn === 'attacker' ? duel.attackerId : duel.defenderId;
}

/**
 * 挑戦できるか（席メニューの「⚔挑む」表示とアクション実行前の判定に使う）。
 * Step 2 ではボットには挑めない（ボットの自動対決は Step 3 で対応）。
 */
export function canChallenge(room: any, myId: string, targetId: string): { ok: boolean; reason?: string } {
  if (room?.mode !== 'yacht') return { ok: false, reason: 'ヨットモードではありません' };
  if (room?.state !== 'playing') return { ok: false, reason: 'ゲーム中ではありません' };
  if (room?.duel) return { ok: false, reason: '対決が進行中です' };
  if (room?.skillUsed?.[myId]) return { ok: false, reason: 'スキルは1ゲームに1回だけです' };
  const g = room?.game;
  if (!g || g.order?.[g.ci] !== myId) return { ok: false, reason: '自分のターンではありません' };
  if (!targetId || targetId === myId) return { ok: false, reason: '自分には挑めません' };
  const target = (room.players ?? []).find((p: any) => p.id === targetId);
  if (!target) return { ok: false, reason: '相手が見つかりません' };
  if (target.isBot) return { ok: false, reason: 'ボットにはまだ挑めません' };
  const ranked = (g.rankings ?? []).some((r: any) => r.id === targetId);
  if (ranked) return { ok: false, reason: '順位が確定した相手には挑めません' };
  return { ok: true };
}

/** 手番側の現在の side を取り出す（dice の RTDB 空配列消失も防御） */
function sideOf(duel: DuelState, turn: 'attacker' | 'defender'): DuelSide {
  const s = turn === 'attacker' ? duel.attacker : duel.defender;
  return {
    dice: Array.isArray(s?.dice) ? s.dice : [],
    rollsLeft: typeof s?.rollsLeft === 'number' ? s.rollsLeft : MAX_ROLLS,
    done: !!s?.done,
    best: s?.best ?? null,
  };
}

/**
 * 現在の手番側がサイコロを振る。keepFlags=null は全部振る（初回）。
 * 残り回数が無い・確定済みなら null（不正操作）を返す。入力は変更しない。
 */
export function applyRoll(
  duel: DuelState,
  keepFlags: boolean[] | null,
  rand: () => number = Math.random
): DuelState | null {
  if (duel.stage !== 'rolling') return null;
  const side = sideOf(duel, duel.turn);
  if (side.done || side.rollsLeft <= 0) return null;
  const dice = (side.dice.length === DICE_COUNT && keepFlags)
    ? reroll(side.dice, keepFlags, rand)
    : rollDice(DICE_COUNT, rand);
  const next: DuelSide = { ...side, dice, rollsLeft: side.rollsLeft - 1 };
  return { ...duel, [duel.turn]: next } as DuelState;
}

/**
 * 現在の手番側が手を確定する（振り直しが残っていても可）。
 * まだ一度も振っていない場合は不可。攻撃側の確定で守備側の番へ、
 * 両者確定で勝敗を判定して stage:'done' にする。
 */
export function applyCommit(duel: DuelState): DuelState | null {
  if (duel.stage !== 'rolling') return null;
  const side = sideOf(duel, duel.turn);
  if (side.done || side.dice.length !== DICE_COUNT) return null;
  const committed: DuelSide = { ...side, done: true, best: bestHand(side.dice) };

  if (duel.turn === 'attacker') {
    return { ...duel, attacker: committed, turn: 'defender' };
  }
  // 守備側の確定＝決着
  const atkBest = duel.attacker.best?.score ?? 0;
  const result = judgeDuel(atkBest, committed.best!.score);
  const winnerId = result === 'attacker' ? duel.attackerId : result === 'defender' ? duel.defenderId : null;
  return { ...duel, defender: committed, stage: 'done', result, winnerId };
}
