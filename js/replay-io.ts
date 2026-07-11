// ========================================
// リプレイ機能: 保存（ダウンロード）
//
// リザルト画面の「📼 リプレイを保存」ボタンから呼ばれる。
// Firebaseに保存されている replayInitialState / actionLog を読み出して、
// リプレイファイル（JSON）としてブラウザからダウンロードさせる。
// ========================================
// @ts-ignore -- db.js はプレーンJS（型定義なし）
import { fbGet } from './db.js';
import type { ReplayFile } from './replay-types';

/**
 * 指定したルームの replayInitialState / actionLog を取得し、
 * ダウンロード可能な ReplayFile の形に組み立てる。
 *
 * まだリプレイデータが存在しない場合（この機能の実装より前に始まった
 * 古いルームなど）は null を返す。
 */
export async function buildReplayFile(roomId: string): Promise<ReplayFile | null> {
  const room = await fbGet('rooms/' + roomId);
  if (!room || !room.replayInitialState || !Array.isArray(room.actionLog)) return null;

  const players = (room.players || []).map((p: { id: string; name: string }) => ({
    id: p.id,
    name: p.name,
  }));

  return {
    version: 1,
    roomId,
    players,
    initialState: room.replayInitialState,
    actionLog: room.actionLog,
    savedAt: Date.now(),
  };
}

/** リプレイファイルをJSONとしてブラウザからダウンロードさせる */
export function downloadReplayFile(replay: ReplayFile): void {
  const blob = new Blob([JSON.stringify(replay)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `replay_${replay.roomId}_${replay.savedAt}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
