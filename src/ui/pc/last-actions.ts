// ========================================
// 「直近の操作」の導出（純粋関数・DOM非依存・テスト対象）
//
// actionLog（リプレイ用に全操作が記録されている）を後ろから走査して、
// プレイヤーごとの「最新のトランプ系操作」「最新のUNO系操作」を1件ずつ拾う。
// ホバーカード（席にマウスを乗せたときの情報表示）のデータ源。
// ========================================
import type { ReplayActionLogEntry } from '../../replay/types';
import type { TrumpCard } from '../../logic/trump-logic.js';

const TRUMP_TYPES = new Set(['trumpPlay', 'trumpPass', 'trumpSkip']);
const UNO_TYPES = new Set(['unoPlay', 'unoDraw', 'unoSkip', 'sayUno', 'pickParentColor']);

export interface LastActions {
  trump: ReplayActionLogEntry | null;
  uno: ReplayActionLogEntry | null;
}

/** actionLog を後ろから走査し、そのプレイヤーの直近①/②操作を返す */
export function lastActionsOf(
  actionLog: ReplayActionLogEntry[] | null | undefined,
  playerId: string
): LastActions {
  const result: LastActions = { trump: null, uno: null };
  if (!Array.isArray(actionLog)) return result;

  for (let i = actionLog.length - 1; i >= 0; i--) {
    const entry = actionLog[i]!;
    if (entry.playerId !== playerId) continue;
    if (!result.trump && TRUMP_TYPES.has(entry.type)) result.trump = entry;
    else if (!result.uno && UNO_TYPES.has(entry.type)) result.uno = entry;
    if (result.trump && result.uno) break;
  }
  return result;
}

/**
 * トランプカードID（'♠5' / 'JOKER' 形式）からカードを復元する。
 * 形式が想定外なら null。
 */
export function parseTrumpCardId(id: string): TrumpCard | null {
  if (id === 'JOKER') return { s: '🃏', v: 'JOKER', id };
  const s = id.slice(0, 1);
  const v = id.slice(1);
  if (!'♠♥♦♣'.includes(s) || v.length === 0) return null;
  return { s, v, id } as TrumpCard;
}

export interface TrumpActionSummary {
  /** 出したカード（trumpPlay時のみ。IDが復元できなかったものは除外） */
  cards: TrumpCard[];
  text: string;
}

/** トランプ系エントリの表示内容を組み立てる */
export function summarizeTrumpEntry(entry: ReplayActionLogEntry): TrumpActionSummary {
  if (entry.type === 'trumpPass') return { cards: [], text: 'パス' };
  if (entry.type === 'trumpSkip') return { cards: [], text: '出し切りスキップ' };

  // trumpPlay
  const ids: string[] = (entry.args as any)?.cardIds ?? [];
  const cards = ids.map(parseTrumpCardId).filter((c): c is TrumpCard => c !== null);

  // 軽い特殊効果の注記（席のホバー用なので厳密でなくてよい）
  const nonJoker = cards.filter(c => c.v !== 'JOKER');
  const isSet = nonJoker.length === 0 || nonJoker.every(c => c.v === nonJoker[0]!.v);
  let note = '';
  if (isSet && nonJoker.some(c => c.v === '8')) note = ' ✂️8切り';
  else if (cards.length === 1 && cards[0]!.v === 'JOKER') note = ' 🃏単体';

  return { cards, text: `を出した${note}` };
}

export interface UnoActionSummary {
  /** 出したカード（unoPlay で記録がある場合のみ） */
  card: { c: string; t: string; v: string } | null;
  text: string;
}

const COLOR_NAMES: Record<string, string> = { red: '赤', blue: '青', green: '緑', yellow: '黄' };

/** UNO系エントリの表示内容を組み立てる */
export function summarizeUnoEntry(entry: ReplayActionLogEntry): UnoActionSummary {
  const args: any = entry.args ?? {};
  switch (entry.type) {
    case 'unoPlay': {
      const colorNote = args.chosenColor ? `（→${COLOR_NAMES[args.chosenColor] ?? args.chosenColor}に変更）` : '';
      // card は記録され始める前の古いログには無い（その場合はカード無しの文言）
      return { card: args.card ?? null, text: args.card ? `を出した${colorNote}` : `カードを出した${colorNote}` };
    }
    case 'unoDraw': {
      const n = typeof args.count === 'number' ? args.count : 1;
      return { card: null, text: n > 1 ? `ペナルティ${n}枚引いた` : '1枚引いた' };
    }
    case 'unoSkip':
      return { card: null, text: '出し切りスキップ' };
    case 'sayUno':
      return { card: null, text: '📢 UNO宣言！' };
    case 'pickParentColor':
      return { card: null, text: `👑 色→${COLOR_NAMES[args.color] ?? args.color}に変更` };
    default:
      return { card: null, text: '' };
  }
}
