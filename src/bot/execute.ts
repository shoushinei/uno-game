// ========================================
// ボットプランの実行
//
// decideBotPlan（strategy.ts）が決めた1手を、実際の game-actions 呼び出しに
// 変換して実行する。actorId を渡せば「その人を代行して」実行できる
// （省略時は自分＝state.myId）。
//
// - test-bot: actorId 省略（自分を操作）
// - absent-runner: 退室者のIDを actorId に渡す（ホストが代行）
// ========================================
import {
  actionTrumpPlay,
  actionTrumpPass,
  actionTrumpSkip,
  actionUnoPlay,
  actionUnoDraw,
  actionUnoSkip,
  actionSayUno,
  actionPickParentColor,
  type ActionResult,
} from '../actions/game-actions.js';
import type { BotPlan } from './strategy.js';

/**
 * プランを実行する。actorId 省略時は自分として実行。
 * 戻り値はエラー診断用（呼び出し側がログに出す）。
 */
export async function executeBotPlan(plan: BotPlan, actorId?: string): Promise<ActionResult | undefined> {
  switch (plan.kind) {
    case 'trumpPlay':
      return actorId ? actionTrumpPlay(plan.cardIds, actorId) : actionTrumpPlay(plan.cardIds);
    case 'trumpPass':
      return actorId ? actionTrumpPass(actorId) : actionTrumpPass();
    case 'trumpSkip':
      return actorId ? actionTrumpSkip(actorId) : actionTrumpSkip();
    case 'parentColor':
      return actorId ? actionPickParentColor(plan.color, actorId) : actionPickParentColor(plan.color);
    case 'unoSkip':
      return actorId ? actionUnoSkip(actorId) : actionUnoSkip();
    case 'unoDraw':
      return actorId ? actionUnoDraw(actorId) : actionUnoDraw();
    case 'unoPlay': {
      // これを出すと残り1枚になる場合は、先にUNO宣言してから出す
      if (plan.sayUnoFirst) {
        if (actorId) await actionSayUno(actorId);
        else await actionSayUno();
      }
      return actorId
        ? actionUnoPlay(plan.idx, plan.color, actorId)
        : actionUnoPlay(plan.idx, plan.color);
    }
    case 'none':
    default:
      return undefined;
  }
}
