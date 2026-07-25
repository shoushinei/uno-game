// ========================================
// ヨット対決のアクション層（Step 2 / Step 3）
//
// Firebase読み → duel-logic適用 → 書き戻し。game-actions.ts と同じ流儀。
// 乱数はクライアント生成（ゲーム進行と同じ信頼境界＝改ざん許容の合意）。
//
// ★Step 3★
// - roll/commit に actorId を追加（ボット・退室者はホストのクライアントが
//   absent-runner から代行実行する。game-actions と同じパターン）
// - close で敗者にUNO4枚のペナルティを適用。UNO側を上がっていた敗者は
//   手札が復活することで自然にゲームへ復帰する（順位未確定者のみが対象
//   なので rankings は触らない）。UNO宣言状態はリセットする
// ========================================
import { state } from '../state.js';
import { fbGet, fbUpdate } from '../db.js';
import {
  newDuel, canChallenge, currentActorId, applyRoll, applyCommit,
  applyDuelPenalty, DUEL_PENALTY_CARDS,
  type DuelState,
} from '../logic/duel-logic.js';
import { makeActionLogEntry, appendActionLog } from '../replay/log.js';
import type { GameState } from '../logic/types.js';

export interface YachtResult { ok?: boolean; error?: string }

const pname = (room: any, id: string): string =>
  (room?.players ?? []).find((p: any) => p.id === id)?.name ?? '?';

/** そのIDが「操作する人が居ない」席か（ボット or 退室中） */
function isUnattended(room: any, id: string): boolean {
  const p = (room?.players ?? []).find((x: any) => x.id === id);
  return !!p?.isBot || !!room?.leftPlayers?.[id];
}

/** 挑戦（スキル発動）。発動した時点で権利は消費される（引き分けでも戻らない） */
export async function actionYachtChallenge(defenderId: string): Promise<YachtResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const check = canChallenge(room, state.myId, defenderId);
  if (!check.ok) return { error: check.reason ?? '挑戦できません' };

  await fbUpdate('rooms/' + state.roomId, {
    duel: newDuel(state.myId, defenderId, Date.now()),
    [`skillUsed/${state.myId}`]: true,
    log: [...(room.log ?? []), `⚔ ${pname(room, state.myId)} が ${pname(room, defenderId)} に🎲ヨット対決を挑んだ！`].slice(-8),
  });
  return { ok: true };
}

/** actorId が現在の手番側であることを確認して duel を取得する共通部 */
async function actorDuel(actorId: string): Promise<{ room: any; duel: DuelState } | { error: string }> {
  const room = await fbGet('rooms/' + state.roomId);
  const duel: DuelState | null = room?.duel ?? null;
  if (!duel) return { error: '対決が見つかりません' };
  if (currentActorId(duel) !== actorId) return { error: '自分の番ではありません' };
  return { room, duel };
}

/** サイコロを振る（keepFlags=null で全部振る） */
export async function actionYachtRoll(
  keepFlags: boolean[] | null,
  actorId: string = state.myId
): Promise<YachtResult> {
  const r = await actorDuel(actorId);
  if ('error' in r) return r;
  const next = applyRoll(r.duel, keepFlags);
  if (!next) return { error: 'もう振れません' };
  await fbUpdate('rooms/' + state.roomId, { duel: next });
  return { ok: true };
}

/** この手で確定する */
export async function actionYachtCommit(actorId: string = state.myId): Promise<YachtResult> {
  const r = await actorDuel(actorId);
  if ('error' in r) return r;
  const next = applyCommit(r.duel);
  if (!next) return { error: 'まだ振っていません' };

  const updates: Record<string, unknown> = { duel: next };
  if (next.stage === 'done') {
    const msg = next.result === 'draw'
      ? '⚔ ヨット対決は引き分け！'
      : `⚔ ヨット対決は ${pname(r.room, next.winnerId!)} の勝ち！`;
    updates.log = [...(r.room.log ?? []), msg].slice(-8);
  }
  await fbUpdate('rooms/' + state.roomId, updates);
  return { ok: true };
}

/**
 * 決着を確定して通常のゲームへ戻る。★Step 3★ ここで敗者にUNO4枚を適用する。
 * 当事者どちらでも押せる。両当事者が操作不能（ボット/退室者）のときだけ
 * ホストが代わりに閉じられる（absent-runner から呼ばれる）。
 */
export async function actionYachtClose(): Promise<YachtResult> {
  const room = await fbGet('rooms/' + state.roomId);
  const duel: DuelState | null = room?.duel ?? null;
  if (!duel) return { ok: true }; // 既に閉じられている
  if (duel.stage !== 'done') return { error: 'まだ決着していません' };
  const parties = [duel.attackerId, duel.defenderId];
  const isParty = parties.includes(state.myId);
  const canProxy = room.host === state.myId && parties.every(id => isUnattended(room, id));
  if (!isParty && !canProxy) return { error: '当事者だけが閉じられます' };

  const updates: Record<string, unknown> = { duel: null };
  const loserId = duel.result === 'attacker' ? duel.defenderId
    : duel.result === 'defender' ? duel.attackerId : null;
  const g = room.game as GameState | null;

  if (loserId && g && room.state === 'playing') {
    // ペナルティ適用は applyDuelPenalty に集約（リプレイ再生側も同じ関数を呼ぶ）
    const { logMsgs } = applyDuelPenalty(g, loserId, pname(room, loserId));
    updates.game = g;
    updates.log = [...(room.log ?? []), ...logMsgs].slice(-8);
  }

  // ★リプレイ対応★ 対決でゲーム状態が変わるのはこの瞬間だけなので、
  // ここで1件だけ actionLog に記録する。これが無いと再生時に敗者の手札が
  // 4枚少ないままとなり、以降の unoPlay(cardIdx) が別のカードを指して
  // リプレイ全体がズレてしまう。
  if (room.state === 'playing') {
    const nextActionLog = appendActionLog(
      room,
      makeActionLogEntry('yachtDuel', duel.attackerId, {
        attackerId: duel.attackerId,
        defenderId: duel.defenderId,
        result: duel.result ?? 'draw',
        loserId,
        penalty: DUEL_PENALTY_CARDS,
        attackerDice: Array.isArray(duel.attacker?.dice) ? duel.attacker.dice : [],
        defenderDice: Array.isArray(duel.defender?.dice) ? duel.defender.dice : [],
        attackerBest: duel.attacker?.best ?? null,
        defenderBest: duel.defender?.best ?? null,
      })
    );
    if (nextActionLog) updates.actionLog = nextActionLog;
  }

  await fbUpdate('rooms/' + state.roomId, updates);
  return { ok: true };
}
