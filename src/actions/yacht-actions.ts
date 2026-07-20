// ========================================
// ヨット対決のアクション層（Step 2）
//
// Firebase読み → duel-logic適用 → 書き戻し。game-actions.ts と同じ流儀。
// 乱数はクライアント生成（ゲーム進行と同じ信頼境界＝改ざん許容の合意）。
//
// Step 2 の範囲: 挑戦〜決着表示〜対決を閉じるまで。
// 敗者のUNO4枚ペナルティは Step 3 で actionYachtClose に組み込む。
// ========================================
import { state } from '../state.js';
import { fbGet, fbUpdate } from '../db.js';
import {
  newDuel, canChallenge, currentActorId, applyRoll, applyCommit,
  type DuelState,
} from '../logic/duel-logic.js';

export interface YachtResult { ok?: boolean; error?: string }

/** 挑戦（スキル発動）。発動した時点で権利は消費される（引き分けでも戻らない） */
export async function actionYachtChallenge(defenderId: string): Promise<YachtResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const check = canChallenge(room, state.myId, defenderId);
  if (!check.ok) return { error: check.reason ?? '挑戦できません' };

  const pname = (id: string) => (room.players ?? []).find((p: any) => p.id === id)?.name ?? '?';
  await fbUpdate('rooms/' + state.roomId, {
    duel: newDuel(state.myId, defenderId, Date.now()),
    [`skillUsed/${state.myId}`]: true,
    log: [...(room.log ?? []), `⚔ ${pname(state.myId)} が ${pname(defenderId)} に🎲ヨット対決を挑んだ！`].slice(-8),
  });
  return { ok: true };
}

/** 自分が現在の手番側であることを確認して duel を取得する共通部 */
async function myDuel(): Promise<{ room: any; duel: DuelState } | { error: string }> {
  const room = await fbGet('rooms/' + state.roomId);
  const duel: DuelState | null = room?.duel ?? null;
  if (!duel) return { error: '対決が見つかりません' };
  if (currentActorId(duel) !== state.myId) return { error: '自分の番ではありません' };
  return { room, duel };
}

/** サイコロを振る（keepFlags=null で全部振る） */
export async function actionYachtRoll(keepFlags: boolean[] | null): Promise<YachtResult> {
  const r = await myDuel();
  if ('error' in r) return r;
  const next = applyRoll(r.duel, keepFlags);
  if (!next) return { error: 'もう振れません' };
  await fbUpdate('rooms/' + state.roomId, { duel: next });
  return { ok: true };
}

/** この手で確定する */
export async function actionYachtCommit(): Promise<YachtResult> {
  const r = await myDuel();
  if ('error' in r) return r;
  const next = applyCommit(r.duel);
  if (!next) return { error: 'まだ振っていません' };

  const updates: Record<string, unknown> = { duel: next };
  if (next.stage === 'done') {
    const pname = (id: string) => (r.room.players ?? []).find((p: any) => p.id === id)?.name ?? '?';
    const msg = next.result === 'draw'
      ? '⚔ ヨット対決は引き分け！'
      : `⚔ ヨット対決は ${pname(next.winnerId!)} の勝ち！`;
    updates.log = [...(r.room.log ?? []), msg].slice(-8);
  }
  await fbUpdate('rooms/' + state.roomId, updates);
  return { ok: true };
}

/**
 * 決着表示を閉じて通常のゲームへ戻る（当事者どちらでも押せる）。
 * ★Step 3 でここに敗者のUNO4枚ドローを組み込む予定★
 */
export async function actionYachtClose(): Promise<YachtResult> {
  const room = await fbGet('rooms/' + state.roomId);
  const duel: DuelState | null = room?.duel ?? null;
  if (!duel) return { ok: true }; // 既に閉じられている
  if (duel.stage !== 'done') return { error: 'まだ決着していません' };
  if (state.myId !== duel.attackerId && state.myId !== duel.defenderId) {
    return { error: '当事者だけが閉じられます' };
  }
  await fbUpdate('rooms/' + state.roomId, { duel: null });
  return { ok: true };
}
