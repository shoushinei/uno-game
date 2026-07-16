// ========================================
// ロビーのボット管理（Phase: ロビーボット）
//
// ホストがロビーで「対戦相手のボット」を追加/削除できるようにする。
// ボットは players 配列の普通のプレイヤー（isBot: true）として扱うため、
// 配札・手番・上がり判定などゲームロジックは一切変更不要。手番の実行だけ
// ホストのクライアントが代行する（absent-runner が退室者と同じ仕組みで担当）。
//
// このモジュールは「生成」と「権限判定」だけを担う純粋関数の集まりで、
// Firebase 書き込みは auth.ts 側が行う（テストしやすくするため）。
// ========================================
import type { Player } from '../logic/types';

/** ルームの最大人数（人間＋ボット合計）。auth.ts の満員判定と一致させる */
export const MAX_ROOM_PLAYERS = 8;

/** ボット名プール（先頭から未使用のものを割り当てる） */
const BOT_NAMES = [
  '🤖ポンタ', '🤖ガブ', '🤖モモ', '🤖クロ',
  '🤖ピノ', '🤖チビ', '🤖リン', '🤖ハチ',
];

/** ランダムなボットID */
function botId(): string {
  return 'bot-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 既存プレイヤーと重複しないボット名を選ぶ。
 * プールが尽きたら「🤖ボットN」で連番フォールバックする。
 */
export function pickBotName(players: Pick<Player, 'name'>[]): string {
  const used = new Set(players.map(p => p.name));
  const free = BOT_NAMES.find(n => !used.has(n));
  if (free) return free;
  for (let i = 1; ; i++) {
    const n = `🤖ボット${i}`;
    if (!used.has(n)) return n;
  }
}

/**
 * 追加するボットプレイヤーを1体生成する。
 * ロビーの players 要素は { id, name, bi, ready } を持つのでそれに合わせ、
 * ボットは常に ready: true（準備待ちで開始をブロックしない）。
 */
export function makeBotPlayer(players: Pick<Player, 'name'>[]): {
  id: string; name: string; bi: number; ready: boolean; isBot: true;
} {
  return {
    id: botId(),
    name: pickBotName(players),
    bi: players.length,
    ready: true,
    isBot: true,
  };
}

/** そのプレイヤーがボットか */
export function isBotPlayer(p: Player | undefined | null): boolean {
  return !!p && p.isBot === true;
}

/**
 * ボットを追加できるか（ホストだけ・ロビー中だけ・満員でない）。
 * 呼び出し側で false のときはボタンを無効化/無視する。
 */
export function canAddBot(
  room: { state?: string; host?: string; players?: Player[] } | null,
  myId: string
): boolean {
  if (!room) return false;
  if (room.state !== 'lobby') return false;
  if (room.host !== myId) return false;
  return (room.players?.length ?? 0) < MAX_ROOM_PLAYERS;
}

/**
 * 指定ボットを削除できるか（ホストだけ・ロビー中だけ・対象が実在のボット）。
 */
export function canRemoveBot(
  room: { state?: string; host?: string; players?: Player[] } | null,
  myId: string,
  botIdToRemove: string
): boolean {
  if (!room) return false;
  if (room.state !== 'lobby') return false;
  if (room.host !== myId) return false;
  const target = room.players?.find(p => p.id === botIdToRemove);
  return isBotPlayer(target);
}

/**
 * 指定プレイヤー（人間）をロビーから追い出せるか
 * （ホストだけ・ロビー中だけ・対象が実在・自分自身は不可）。
 * ボットにも使えるが、ボットの削除は canRemoveBot（確認なし）を使う。
 */
export function canKickPlayer(
  room: { state?: string; host?: string; players?: Player[] } | null,
  myId: string,
  targetId: string
): boolean {
  if (!room) return false;
  if (room.state !== 'lobby') return false;
  if (room.host !== myId) return false;
  if (targetId === myId) return false;
  return !!room.players?.some(p => p.id === targetId);
}

/** players から isBot 由来の { [id]: true } マップを作る（代行判定・描画用） */
export function botPlayerMap(players: Player[] | undefined | null): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const p of players ?? []) {
    if (p.isBot) map[p.id] = true;
  }
  return map;
}
