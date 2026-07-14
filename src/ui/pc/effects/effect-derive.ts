// ========================================
// 演出の導出（純粋関数・DOM非依存・テスト対象）
//
// 「何を再生するか」(EffectDescriptor) の決定だけを担当し、
// 「どう描くか」は effect-render.ts に完全分離する。
//
// 検知源は2系統:
//   A. actionLog の増分  … 「誰が・何をしたか」(行為者中心)
//   B. ゲーム状態のdiff … 「盤面がどう変わったか」(結果中心)
//      ※ 全員パスの場流しは actionLog に専用エントリが無いため、
//        trumpField「あり→空」の差分でしか検知できない
// ========================================
import type { ReplayActionLogEntry } from '../../../replay/types';
import type { TrumpCard } from '../../../logic/trump-logic.js';
import { parseTrumpCardId } from '../last-actions.js';

// ---- 演出の種類 ----
export type EffectDescriptor =
  | { kind: 'game-start'; firstPlayerName: string; seatIds: string[] }
  | { kind: 'trump-play'; playerId: string; cards: TrumpCard[] }
  | { kind: 'uno-play'; playerId: string; card: { c: string; t: string; v: string } | null }
  | { kind: 'draw'; playerId: string; count: number }
  | { kind: 'pass'; playerId: string }
  | { kind: 'say-uno'; playerId: string }
  | { kind: 'parent-color'; playerId: string; color: string }
  | { kind: 'field-clear'; parentId: string | null }
  | { kind: 'reverse'; dir: number }
  | { kind: 'finish'; playerId: string; rank: number }
  | { kind: 'trump-special'; types: string[]; playerId: string; revolutionOn: boolean };

/**
 * 1回の同期で増えたエントリがこの数を超えていたら（再接続・追いつき等）
 * 演出をすべてスキップする
 */
export const MASS_SKIP_THRESHOLD = 5;

// ----------------------------------------
// A. actionLog エントリからの導出
// ----------------------------------------
export function deriveFromEntries(entries: ReplayActionLogEntry[]): EffectDescriptor[] {
  if (entries.length > MASS_SKIP_THRESHOLD) return [];

  const out: EffectDescriptor[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const args: any = entry.args ?? {};
    switch (entry.type) {
      case 'trumpPlay': {
        const ids: string[] = Array.isArray(args.cardIds) ? args.cardIds : [];
        const cards = ids.map(parseTrumpCardId).filter((c): c is TrumpCard => c !== null);
        out.push({ kind: 'trump-play', playerId: entry.playerId, cards });
        break;
      }
      case 'unoPlay':
        out.push({ kind: 'uno-play', playerId: entry.playerId, card: args.card ?? null });
        break;
      case 'unoDraw':
        out.push({ kind: 'draw', playerId: entry.playerId, count: typeof args.count === 'number' ? args.count : 1 });
        break;
      case 'trumpPass':
        out.push({ kind: 'pass', playerId: entry.playerId });
        break;
      case 'sayUno':
        out.push({ kind: 'say-uno', playerId: entry.playerId });
        break;
      case 'pickParentColor':
        out.push({ kind: 'parent-color', playerId: entry.playerId, color: args.color ?? '' });
        break;
      // trumpSkip / unoSkip はフェイズ切替のハイライト移動（CSS）で十分伝わるため
      // 専用演出は出さない（bot対戦では毎ターン発生し、うるさくなる）
    }
  }
  return out;
}

// ----------------------------------------
// B. 状態diffからの導出
// ----------------------------------------

/**
 * diff比較用の軽量スナップショット。
 * room.game をそのまま持つと、再描画時に同じオブジェクト参照を比較して
 * しまい差分が検知できない（エイリアシング）ため、必要なスカラーだけ写し取る。
 */
export interface GameSnap {
  fieldLen: number;
  hasParent: string | null;
  dir: number;
  rankingIds: string[];
  actionLogLen: number;
}

export function takeSnapshot(g: any, room: any): GameSnap {
  return {
    fieldLen: Array.isArray(g.trumpField) ? g.trumpField.length : 0,
    hasParent: g.hasParent ?? null,
    dir: g.dir ?? 1,
    rankingIds: (g.rankings || []).map((r: { id: string }) => r.id),
    actionLogLen: Array.isArray(room.actionLog) ? room.actionLog.length : 0,
  };
}

export function deriveFromDiff(
  prev: GameSnap | null,
  next: GameSnap,
  g: any,
  players: Array<{ id: string; name: string }>
): EffectDescriptor[] {
  const out: EffectDescriptor[] = [];

  // ゲーム開始: 前回スナップが無く、まだ誰も操作していない
  // （リロード・途中参加では actionLog が既に進んでいるので発火しない）
  if (prev === null) {
    if (next.actionLogLen === 0 && next.rankingIds.length === 0) {
      const firstId = g.order?.[g.ci];
      out.push({
        kind: 'game-start',
        firstPlayerName: players.find(p => p.id === firstId)?.name ?? '?',
        seatIds: Array.isArray(g.order) ? g.order : [],
      });
    }
    return out; // 初回はdiff不能なのでここまで
  }

  // 場流し（トランプの場: あり → 空）
  if (prev.fieldLen > 0 && next.fieldLen === 0) {
    out.push({ kind: 'field-clear', parentId: next.hasParent });
  }

  // リバース
  if (prev.dir !== next.dir) {
    out.push({ kind: 'reverse', dir: next.dir });
  }

  // 上がり（rankingsが増えた）
  if (next.rankingIds.length > prev.rankingIds.length) {
    for (let i = prev.rankingIds.length; i < next.rankingIds.length; i++) {
      out.push({ kind: 'finish', playerId: next.rankingIds[i]!, rank: i + 1 });
    }
  }

  return out;
}

// ----------------------------------------
// C. trumpEffect（applyTrumpPlay が書き込む特殊効果）からの導出
//    ts の重複ガードは呼び出し側（table-render）が行う
// ----------------------------------------
export function deriveTrumpSpecial(te: any, revolutionOn: boolean): EffectDescriptor | null {
  const types: string[] = Array.isArray(te?.types) ? te.types : (te?.type ? [te.type] : []);
  if (types.length === 0) return null;
  return { kind: 'trump-special', types, playerId: te.playerId ?? '', revolutionOn };
}
