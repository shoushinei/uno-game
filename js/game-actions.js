// ========================================
// ゲームアクション（Firebase書き込み層）
//
// 責務：
//   1. Firebaseから最新のgameを読む
//   2. ゲームロジック関数（*-logic.js / game-rules.js）を呼ぶ
//   3. 結果をFirebaseに書き戻す
//
// この層はDOMに直接触れない。
// UIイベント（選択状態、ピッカー表示）は app.js が処理してからここを呼ぶ。
// ========================================
import { state } from './state.js';
import { fbGet, fbUpdate, fbSet } from './db.js';
import { initFusionGame } from './game-init.js';
import { applyTrumpPlay, applyTrumpPass } from './trump-logic.ts';
import { applyUnoPlay, applyUnoDraw } from './uno-logic.js';
import {
  checkAllPassed,
  resolveRankingNames,
  applyTrumpSkip,
  applyUnoSkip,
  applyParentColorChange,
  applyUnoDeclaration,
} from './game-rules.js';

// ----------------------------------------
// ヘルパー：プレイヤー名取得
// ----------------------------------------
function getPlayerName(players) {
  return players.find(p => p.id === state.myId)?.name ?? state.myName;
}

// ----------------------------------------
// ヘルパー：ログ追記（末尾8件を維持）
// ----------------------------------------
function appendLog(room, msg) {
  return [...(room.log ?? []), msg].slice(-8);
}

// ----------------------------------------
// ゲーム開始
// ----------------------------------------
export async function actionStartGame() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room || state.myId !== room.host) return;
  const players = room.players ?? [];
  if (players.length < 3) return { error: '3人以上必要です' };

  const game = initFusionGame(players);
  await fbUpdate('rooms/' + state.roomId, {
    state: 'playing',
    game,
    log: ['🎮 大富豪×UNO 融合ゲーム開始！'],
    trumpPassCount: 0,
  });
  return { ok: true };
}

// ----------------------------------------
// トランプ：カードを出す
// ----------------------------------------
export async function actionTrumpPlay(selectedCardIds) {
  if (!selectedCardIds.length) return { error: 'カードが選択されていません' };

  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const fCards = Array.isArray(g.trumpField) ? g.trumpField : [];
  if (fCards.length > 0 && selectedCardIds.length !== fCards.length) {
    return { error: `場の枚数（${fCards.length}枚）と一致させてください` };
  }

  const pname = getPlayerName(room.players);
  const result = applyTrumpPlay(g, state.myId, selectedCardIds, pname);
  if (!result) return { error: '選択したカードの組み合わせは出せません' };

  await fbUpdate('rooms/' + state.roomId, {
    game: result.g,
    log: appendLog(room, result.logMsg),
    trumpPassCount: 0,
  });
  return { ok: true };
}

// ----------------------------------------
// トランプ：パス
// ----------------------------------------
export async function actionTrumpPass() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players);
  const passCount = (room.trumpPassCount ?? 0) + 1;
  const { g: newG, logMsg } = applyTrumpPass(g, state.myId, pname);
  const logs = appendLog(room, logMsg);

  // パス後に全員パスが成立するか判定
  const passResult = checkAllPassed(newG, passCount, room.players);
  if (passResult.cleared) logs.push(passResult.logMsg);

  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : passCount,
  });
  return { ok: true };
}

// ----------------------------------------
// トランプ：スキップ（手札0枚）
// ----------------------------------------
export async function actionTrumpSkip() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'trump') {
    return { error: '自分のターン（トランプフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players);
  const { logMsg } = applyTrumpSkip(g, pname);

  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: appendLog(room, logMsg),
  });
  return { ok: true };
}

// ----------------------------------------
// UNO：スキップ（手札0枚）
// ★バグ修正で追加★ トランプを出し切った時の actionTrumpSkip と対になる処理。
// UNOを出し切ったプレイヤーが「引く」しかできず足止めされていたのを解消する。
// ----------------------------------------
export async function actionUnoSkip() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }
  const myUno = (g.unoHands && g.unoHands[state.myId]) || [];
  if (myUno.length > 0) {
    return { error: 'UNO手札が残っているためスキップできません' };
  }

  const pname = getPlayerName(room.players);
  const currentPassCount = room.trumpPassCount ?? 0;
  const { logMsg } = applyUnoSkip(g, state.myId, pname);
  const logs = appendLog(room, logMsg);

  // スキップ後に全員パスが成立するか判定（場が流れる）
  const passResult = checkAllPassed(g, currentPassCount, room.players);
  if (passResult.cleared) logs.push(passResult.logMsg);

  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : currentPassCount,
  });
  return { ok: true };
}

// ----------------------------------------
// UNO：カードを出す（共通処理）
// ----------------------------------------
export async function actionUnoPlay(cardIdx, chosenColor) {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players);
  const currentPassCount = room.trumpPassCount ?? 0;

  const result = applyUnoPlay(g, state.myId, cardIdx, chosenColor, pname);
  if (!result) return { error: 'そのカードは出せません' };

  const { g: newG, logMsg, isGameOver } = result;

  if (isGameOver) resolveRankingNames(newG.rankings, room.players);

  const logs = appendLog(room, logMsg);

  // UNO後に全員パスが成立するか判定（場が流れる）
  const passResult = checkAllPassed(newG, currentPassCount, room.players);
  if (passResult.cleared) logs.push(passResult.logMsg);

  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : currentPassCount,
    ...(isGameOver ? { state: 'ended' } : {}),
  });
  return { ok: true, isGameOver };
}

// ----------------------------------------
// UNO：カードを引く
// ----------------------------------------
export async function actionUnoDraw() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g || g.order[g.ci] !== state.myId || g.phase !== 'uno') {
    return { error: '自分のターン（UNOフェイズ）ではありません' };
  }

  const pname = getPlayerName(room.players);
  const currentPassCount = room.trumpPassCount ?? 0;
  const { g: newG, logMsg } = applyUnoDraw(g, state.myId, pname);
  const logs = appendLog(room, logMsg);

  const passResult = checkAllPassed(newG, currentPassCount, room.players);
  if (passResult.cleared) logs.push(passResult.logMsg);

  await fbUpdate('rooms/' + state.roomId, {
    game: newG,
    log: logs.slice(-8),
    trumpPassCount: passResult.cleared ? 0 : currentPassCount,
  });
  return { ok: true };
}

// ----------------------------------------
// UNO宣言
// ----------------------------------------
export async function actionSayUno() {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g) return { error: 'ゲームが開始されていません' };

  const pname = getPlayerName(room.players);
  const { logMsg } = applyUnoDeclaration(g, state.myId, pname);

  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: appendLog(room, logMsg),
  });
  return { ok: true };
}

// ----------------------------------------
// 親の色変更
// ----------------------------------------
export async function actionPickParentColor(color) {
  const room = await fbGet('rooms/' + state.roomId);
  if (!room) return { error: 'ルームが見つかりません' };
  const g = room.game;
  if (!g) return { error: 'ゲームが開始されていません' };

  const pname = getPlayerName(room.players);
  const result = applyParentColorChange(g, state.myId, color, pname);
  if (!result) return { error: '親の権限がありません' };

  await fbUpdate('rooms/' + state.roomId, {
    game: g,
    log: appendLog(room, result.logMsg),
  });
  return { ok: true };
}

// ----------------------------------------
// リアクション送信
// ----------------------------------------
export async function actionSendReaction(emoji) {
  await fbSet(`rooms/${state.roomId}/reactions/${state.myId}`, { emoji, ts: Date.now() });
  return { ok: true };
}
