// ========================================
// ゲームアクション（Firebase書き込み層）
//
// 責務：
//   1. Firebaseから最新のgameを読む
//   2. ゲームロジック関数（*-logic.ts / game-rules.ts）を呼ぶ
//   3. 結果をFirebaseに書き戻す
//
// この層はDOMに直接触れない。
// UIイベント（選択状態、ピッカー表示）は app.js が処理してからここを呼ぶ。
// ========================================
import { state } from '../state.js';
import { fbGet, fbUpdate, fbSet } from '../db.js';
import { initFusionGame } from '../logic/game-init.js';
// ※ .ts 拡張子での import は allowImportingTsExtensions が無効のため
// TSファイルからはエラーになる。プロジェクト標準の .js 拡張子表記に統一
// （Vite/tsc が実体の .ts を解決してくれる）。
import { applyTrumpPlay, applyTrumpPass } from '../logic/trump-logic.js';
import { applyUnoPlay, applyUnoDraw } from '../logic/uno-logic.js';
import {
  checkAllPassed,
  resolveRankingNames,
  applyTrumpSkip,
  applyUnoSkip,
  applyParentColorChange,
  applyUnoDeclaration,
  checkInvariants,
  reportInvariantViolations,
} from '../logic/game-rules.js';
// ★リプレイ機能で追加★
// actionLog（操作の履歴）を組み立てて room.actionLog に追記するためのヘルパー。
// assertInvariants と全く同じパターンで、既存の fbUpdate 呼び出しに乗せて使う。
import { makeActionLogEntry, appendActionLog } from '../replay/log.js';
import type { GameState, Player } from '../logic/types';

/** 各アクションの戻り値（成功時は ok、失敗時は error にメッセージ） */
export interface ActionResult {
  ok?: boolean;
  error?: string;
  isGameOver?: boolean;
}

// ----------------------------------------
// ヘルパー：Firebaseへ書き込む直前に不変条件をチェックする
// ★機能追加★ 各アクションの最後（fbUpdate直前）でこれを呼ぶことで、
// 「本来ありえないはずのゲーム状態」を書き込んでしまう前にコンソールへ
// 検出ログを出す。書き込み自体はブロックしない（診断専用）。
// ----------------------------------------
function assertInvariants(actionName: string, g: GameState, players: Player[]): void {
  const violations = checkInvariants(g, players);
  reportInvariantViolations(actionName, g, violations);
}

// ----------------------------------------
// ヘルパー：プレイヤー名取得
// ★C1（actorId化）★ 代行実行では自分以外のプレイヤーとして操作するため、
// 名前も actorId で引く。actorId が自分自身なら従来どおり state.myName に
// フォールバックする（players に自分が未登録の一瞬でも名前を出すため）。
// ----------------------------------------
function getPlayerName(players: Player[], actorId: string): string {
  const found = players.find(p => p.id === actorId)?.name;
  if (found) return found;
  return actorId === state.myId ? state.myName : '?';
}

// ----------------------------------------
// ヘルパー：ログ追記（末尾8件を維持）
// ----------------------------------------
function appendLog(room: any, msg: string): string[] {
  return [...(room.log ?? []), msg].slice(-8);
}

// ----------------------------------------
// ゲーム開始
// ----------------------------------------
export async function actionStartGame(): Promise<ActionResult | undefined> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room || state.myId !== room.host) return;
  const players: Player[] = room.players ?? [];
  if (players.length < 3) return { error: '3人以上必要です' };

  const game = initFusionGame(players);
  assertInvariants('actionStartGame', game, players);
  await fbUpdate('rooms/' + state.roomId, {
    state: 'playing',
    game,
    // ★Phase 2（戦績）★ 対局ごとの一意ID。Cloud Functions がゲーム終了時の
    // 戦績書き込みの冪等性（同じゲームの二重記録防止）に使う。
    // 同じルームで再戦しても毎回新しいIDになる。
    gameId: `${state.roomId}-${Date.now()}`,
    log: ['🎮 大富豪×UNO 融合ゲーム開始！'],
    trumpPassCount: 0,
    // ★リプレイ機能で追加★
    // actionLog: このゲーム中の全操作をこれから1件ずつ追記していく配列。ここで空配列に初期化する。
    // replayInitialState: 配り終わった直後（乱数が確定した直後）の game をそのまま複製して保存する。
    // これは game 自体（毎アクションで上書きされる「現在値」）とは別に、
    // リプレイ再生の起点として1回だけ保存すれば十分な値。
    actionLog: [],
    replayInitialState: game,
  });
  return { ok: true };
}

// ----------------------------------------
// トランプ：カードを出す
// ----------------------------------------
export async function actionTrumpPlay(selectedCardIds: string[], actorId: string = state.myId): Promise<ActionResult> {
  if (!selectedCardIds.length) return { error: 'カードが選択されていません' };

  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
  if (fCards.length > 0 && selectedCardIds.length !== fCards.length) {
    return { error: `場の枚数（${fCards.length}枚）と一致させてください` };
  }

  const pname = getPlayerName(room.players, actorId);
  const result = applyTrumpPlay(g, actorId, selectedCardIds, pname);
  if (!result) return { error: '選択したカードの組み合わせは出せません' };

  // TrumpGameState は GameState の実行時サブセット（実体は常に完全な融合状態）
  // のため型のみ GameState として扱う（trump-logic.ts 内の同様のケースと同じ理由）
  const newG = result.g as unknown as GameState;
  const { logMsg, isGameOver } = result;

  // ★バグ修正★ applyTrumpPlay は、このプレイでトランプ・UNO両方の手札が
  // 0枚になった場合 isGameOver: true を返すようになった。以前はこの戻り値を
  // 一切見ておらず、ランキング名の補完（resolveRankingNames）も
  // Firebaseへの state: 'ended' 送信も行われていなかったため、
  // 最後のプレイヤーがトランプを出し切ってもゲームが終了しない不具合があった。
  // 他のアクション（actionUnoPlay 等）と同じ扱いに揃える。
  if (isGameOver) resolveRankingNames(newG.rankings, room.players);

  // ★リプレイ機能で追加★
  // room.actionLog が既に配列として存在するルーム（＝actionStartGameで初期化済み）
  // でのみ追記される。古いルーム（actionLog未対応）では null が返り、
  // 下の fbUpdate では actionLog キー自体を送らないようにする。
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('trumpPlay', actorId, { cardIds: selectedCardIds })
  );

  assertInvariants('actionTrumpPlay', newG, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: appendLog(room, logMsg),
    trumpPassCount: 0,
    ...(isGameOver ? { state: 'ended' } : {}),
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true, isGameOver };
}

// ----------------------------------------
// トランプ：パス
// ----------------------------------------
export async function actionTrumpPass(actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players, actorId);
  const passCount = (room.trumpPassCount ?? 0) + 1;
  const passRes = applyTrumpPass(g, actorId, pname);
  // TrumpGameState → GameState（actionTrumpPlay と同じ理由の型合わせ）
  const newG = passRes.g as unknown as GameState;
  const logs = appendLog(room, passRes.logMsg);

  // パス後に全員パスが成立するか判定
  const passResult = checkAllPassed(newG, passCount, room.players);
  if (passResult.cleared && passResult.logMsg) logs.push(passResult.logMsg);

  // ★リプレイ機能で追加★
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('trumpPass', actorId, {})
  );

  assertInvariants('actionTrumpPass', newG, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : passCount,
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true };
}

// ----------------------------------------
// トランプ：スキップ（手札0枚）
// ★バグ修正★ state.myId（playerId）を applyTrumpSkip に渡すよう変更。
// applyTrumpSkip 内で「UNO手札も0枚か」を判定し、両方0枚なら
// UNOフェイズへは進めずその場で上がり確定させる（isGameOver対応）。
//
// ★バグ修正（追加）★
// 手札0枚による強制スキップは、実質的には「出せないのでパスした」のと
// 同じ状態である。しかし従来はここで trumpPassCount を一切増やしておらず、
// checkAllPassed（全員パス判定）も呼んでいなかった。
// そのため、残り3人中2人がトランプを出し切って0枚になった場合、
// その2人は毎ターン強制スキップされるだけでパスとしてカウントされず、
// 唯一手札が残っているプレイヤーが何を出しても場が流れず「親」になれない
// 不具合が発生していた。
// ここで actionTrumpPass と同様に trumpPassCount をインクリメントし
// checkAllPassed を呼ぶことで、手札0枚のプレイヤーの強制スキップも
// 「パス」として正しく数えられるようにする。
//
// ★リプレイ機能で追加★
// この関数は isGameOver / finished / 通常時の3つの経路で
// それぞれ別に fbUpdate を呼んでいるため、actionLog への追記も
// 3箇所すべてに反映させる必要がある（1箇所でも忘れるとリプレイが
// その手数だけ再現できなくなる）。
// ----------------------------------------
export async function actionTrumpSkip(actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players, actorId);
  const passCount = (room.trumpPassCount ?? 0) + 1;
  const { logMsg, isGameOver, finished } = applyTrumpSkip(g, actorId, pname);
  const logs = appendLog(room, logMsg);

  // ★リプレイ機能で追加★
  // 手札0枚による自動スキップも「アクション」として記録する
  // （再生時に applyTrumpSkip を同じ手順で呼び直せるようにするため）。
  // このオブジェクトを3つの fbUpdate すべてに共通して使い回す。
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('trumpSkip', actorId, {})
  );
  const actionLogPatch = nextActionLog ? { actionLog: nextActionLog } : {};

  if (isGameOver) {
    // 上がり確定でゲームが終了した場合は、場流し判定は意味がないのでスキップする
    resolveRankingNames(g.rankings, room.players);
    assertInvariants('actionTrumpSkip(isGameOver)', g, room.players);
    await fbUpdate('rooms/' + state.roomId, {
      game: g,
      log: logs,
      state: 'ended',
      ...actionLogPatch, // ★リプレイ機能で追加
    });
    return { ok: true, isGameOver };
  }

  // ★バグ修正★ このターンで誰かが「上がった」場合（finished:true）は、
  // その上がりによって g.order.length が短くなった直後の状態で
  // checkAllPassed を呼ぶと、パス数の閾値（g.order.length - 1）が
  // 意図せずズレて「全員パス成立」を誤検知してしまうことがあった。
  // 上がり確定の直後は「パスした」という意味合いではないため、
  // checkAllPassed 自体を呼ばずに素直に書き込む。
  if (finished) {
    assertInvariants('actionTrumpSkip(finished)', g, room.players);
    await fbUpdate('rooms/' + state.roomId, {
      game: g,
      log: logs.slice(-8),
      ...actionLogPatch, // ★リプレイ機能で追加
    });
    return { ok: true, isGameOver: false };
  }

  // 強制スキップを「パス」として計上し、全員パスが成立するか判定する
  const passResult = checkAllPassed(g, passCount, room.players);
  if (passResult.cleared && passResult.logMsg) logs.push(passResult.logMsg);

  assertInvariants('actionTrumpSkip', g, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : passCount,
    ...actionLogPatch, // ★リプレイ機能で追加
  });
  return { ok: true, isGameOver: false };
}

// ----------------------------------------
// UNO：スキップ（手札0枚）
// ★バグ修正で追加★ トランプを出し切った時の actionTrumpSkip と対になる処理。
// UNOを出し切ったプレイヤーが「引く」しかできず足止めされていたのを解消する。
//
// ★バグ修正★ applyUnoSkip 内で「トランプ手札も0枚か」を判定し、
// 両方0枚ならその場で上がり確定させる（isGameOver対応）。ゲームが終了した
// 場合は全員パス判定（checkAllPassed）をスキップする。
// ----------------------------------------
export async function actionUnoSkip(actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }
  const myUno = (g.unoHands && g.unoHands[actorId]) || [];
  if (myUno.length > 0) {
    return { error: 'UNO手札が残っているためスキップできません' };
  }

  const pname = getPlayerName(room.players, actorId);
  const currentPassCount = room.trumpPassCount ?? 0;
  const { logMsg, isGameOver, finished } = applyUnoSkip(g, actorId, pname);
  const logs = appendLog(room, logMsg);

  if (isGameOver) resolveRankingNames(g.rankings, room.players);

  // ★バグ修正★ このターンで誰かが「上がった」場合（finished:true）は、
  // g.order.length が短くなった直後の状態のまま checkAllPassed を呼ぶと
  // パス閾値が意図せずズレて誤検知することがあるため、
  // 上がり確定時は checkAllPassed を呼ばずに書き込む。
  let passCleared = false;
  if (!isGameOver && !finished) {
    const passResult = checkAllPassed(g, currentPassCount, room.players);
    if (passResult.cleared) {
      if (passResult.logMsg) logs.push(passResult.logMsg);
      passCleared = true;
    }
  }

  // ★リプレイ機能で追加★
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('unoSkip', actorId, {})
  );

  assertInvariants('actionUnoSkip', g, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: logs.slice(-8),
    trumpPassCount: passCleared ? 0 : currentPassCount,
    ...(isGameOver ? { state: 'ended' } : {}),
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true, isGameOver };
}

// ----------------------------------------
// UNO：カードを出す（共通処理）
// ----------------------------------------
export async function actionUnoPlay(cardIdx: number | null, chosenColor?: string | null, actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players, actorId);
  const currentPassCount = room.trumpPassCount ?? 0;

  // ★PC UI（ホバーカード）で追加★ 出すカードを apply 前に控えておく
  // （applyUnoPlay が手札から取り除くため、後からは特定できない）
  const playedCard = cardIdx !== null ? ((g.unoHands?.[actorId] ?? [])[cardIdx] ?? null) : null;

  const result = applyUnoPlay(g, actorId, cardIdx, chosenColor ?? null, pname);
  if (!result) return { error: 'そのカードは出せません' };

  const { g: newG, logMsg, isGameOver } = result;

  if (isGameOver) resolveRankingNames(newG.rankings, room.players);

  const logs = appendLog(room, logMsg);

  // UNO後に全員パスが成立するか判定（場が流れる）
  const passResult = checkAllPassed(newG, currentPassCount, room.players);
  if (passResult.cleared && passResult.logMsg) logs.push(passResult.logMsg);

  // ★リプレイ機能で追加★
  // chosenColor は null の場合もそのまま null として記録する
  // （ワイルドではない通常カードでは常に null になる想定）。
  // ※ result が non-null ＝ カードは実際に出せた＝ cardIdx は必ず有効な数値
  //   （null なら applyUnoPlay が null を返して上で早期リターン済み）。
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('unoPlay', actorId, {
      cardIdx: cardIdx!,
      chosenColor: chosenColor ?? null,
      card: playedCard, // ★PC UI（ホバーカード）の表示用。リプレイ再生では使わない
    })
  );

  assertInvariants('actionUnoPlay', newG, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : currentPassCount,
    ...(isGameOver ? { state: 'ended' } : {}),
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true, isGameOver };
}

// ----------------------------------------
// UNO：カードを引く
// ----------------------------------------
export async function actionUnoDraw(actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== actorId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players, actorId);
  const currentPassCount = room.trumpPassCount ?? 0;
  // ★PC UI（ホバーカード）で追加★ 引く枚数を apply 前に控えておく（表示用）
  const drawCount = g.unoPenaltyAccum > 0 ? g.unoPenaltyAccum : 1;
  const { g: newG, logMsg } = applyUnoDraw(g, actorId, pname);
  const logs = appendLog(room, logMsg);

  const passResult = checkAllPassed(newG, currentPassCount, room.players);
  if (passResult.cleared && passResult.logMsg) logs.push(passResult.logMsg);

  // ★リプレイ機能で追加★
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('unoDraw', actorId, { count: drawCount })
  );

  assertInvariants('actionUnoDraw', newG, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : currentPassCount,
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true };
}

// ----------------------------------------
// UNO宣言
// ----------------------------------------
export async function actionSayUno(actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g) return { error: 'ゲームが開始されていません' };

  const pname = getPlayerName(room.players, actorId);
  const { logMsg } = applyUnoDeclaration(g, actorId, pname);

  // ★リプレイ機能で追加★
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('sayUno', actorId, {})
  );

  assertInvariants('actionSayUno', g, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: appendLog(room, logMsg),
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true };
}

// ----------------------------------------
// 親の色変更
// ----------------------------------------
export async function actionPickParentColor(color: string, actorId: string = state.myId): Promise<ActionResult> {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g) return { error: 'ゲームが開始されていません' };

  const pname = getPlayerName(room.players, actorId);
  const result = applyParentColorChange(g, actorId, color, pname);
  if (!result) return { error: '親の権限がありません' };

  // ★バグ修正：親の権限行使によるゲーム終了（isGameOver）の判定を反映する
  const isGameOver = !!result.isGameOver;
  if (isGameOver) resolveRankingNames(g.rankings, room.players);

  // ★リプレイ機能で追加★
  const nextActionLog = appendActionLog(
    room,
    makeActionLogEntry('pickParentColor', actorId, { color })
  );

  assertInvariants('actionPickParentColor', g, room.players);
  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: appendLog(room, result.logMsg),
    ...(isGameOver ? { state: 'ended' } : {}), // ゲーム終了時は部屋のステートを ended に変更
    ...(nextActionLog ? { actionLog: nextActionLog } : {}), // ★リプレイ機能で追加
  });
  return { ok: true, isGameOver };
}

// ----------------------------------------
// リアクション送信
// ----------------------------------------
// targetId を渡すと「対人リアクション」（特定プレイヤー宛て）になる。
// 省略時は従来どおり全体向けの自己リアクション。1スキーマ両立のため
// reactions/{myId} に targetId を任意フィールドとして載せる。
export async function actionSendReaction(emoji: string, targetId?: string): Promise<ActionResult> {
  const payload: { emoji: string; ts: number; targetId?: string } = { emoji, ts: Date.now() };
  if (targetId) payload.targetId = targetId;
  await fbSet(`rooms/${state.roomId}/reactions/${state.myId}`, payload);
  return { ok: true };
}

// ----------------------------------------
// ★機能追加★ 自動プレイ（テストボット）ON/OFFの共有
//
// これまで test-bot.js のON/OFFは自分のブラウザのボタン表示が
// 変わるだけで、Firebaseには一切書き込まれていなかった。そのため
// 他のプレイヤーからは「誰かが自動プレイ中かどうか」が全く分からなかった。
//
// rooms/{roomId}/autoPlayers/{playerId} に真偽値を書き込み、
// 全プレイヤーがルームを購読していれば自動的に反映されるようにする。
// OFFにする際は false ではなく null を書き込み、Firebaseからキーごと
// 消す（他の場所で使っている「空＝キーが無い」という規約に合わせる）。
//
// ※この関数はリプレイには関係しないため、actionLogへの記録は行わない。
// ----------------------------------------
export async function actionSetAutoPlay(isOn: boolean): Promise<ActionResult> {
  await fbSet(`rooms/${state.roomId}/autoPlayers/${state.myId}`, isOn ? true : null);
  return { ok: true };
}
