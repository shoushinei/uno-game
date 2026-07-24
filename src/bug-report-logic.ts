// ========================================
// バグ報告の純粋ロジック（Firebase・DOM 非依存・vitest 対象）
//
// friends.ts / friends-util.ts と同じ分離パターン: Firestore を触る部分は
// bug-report.ts、ペイロード組み立て・切り詰め・クールダウン判定はこちら。
// サイズ上限は firestore.rules の検証値と一致させること。
// ========================================

// ---- サイズ上限（Firestore 1MB/doc に収める。firestore.rules と一致させる） ----
export const MAX_DESCRIPTION = 1000;
export const MAX_SNAPSHOT_CHARS = 300_000;
export const MAX_REPLAY_CHARS = 600_000;
export const MAX_ERRORS_CHARS = 20_000;
/** 連投防止のクールダウン（ミリ秒） */
export const SUBMIT_COOLDOWN_MS = 60_000;

export interface CapturedError { ts: number; msg: string }

/** 循環参照に耐える JSON.stringify（失敗したらプレースホルダ文字列） */
export function safeJson(value: unknown): string {
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    }) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
}

/** 上限を超える文字列を末尾切り詰めする。切り詰めたかどうかも返す */
export function truncateForReport(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

/** クールダウン判定（lastAt=0 は未送信） */
export function canSubmit(now: number, lastAt: number): boolean {
  return now - lastAt >= SUBMIT_COOLDOWN_MS;
}

export interface BugReportInput {
  description: string;
  room: unknown | null;
  replay: unknown | null;
  errors: CapturedError[];
  uid: string;
  name: string;
  roomId: string;
  uiMode: 'pc' | 'classic';
  userAgent: string;
}

/**
 * Firestore へ書くドキュメント（createdAt を除く）を組み立てる。
 * どのフィールドも上限内に収め、切り詰めが発生したら truncated: true を立てる。
 */
export function buildBugReportPayload(input: BugReportInput): Record<string, unknown> {
  const desc = truncateForReport(input.description.trim(), MAX_DESCRIPTION);
  const snap = truncateForReport(input.room === null ? '' : safeJson(input.room), MAX_SNAPSHOT_CHARS);
  const replay = truncateForReport(input.replay === null ? '' : safeJson(input.replay), MAX_REPLAY_CHARS);
  const errors = truncateForReport(safeJson(input.errors), MAX_ERRORS_CHARS);
  return {
    uid: input.uid,
    name: String(input.name).slice(0, 20),
    roomId: String(input.roomId).slice(0, 20),
    uiMode: input.uiMode,
    userAgent: String(input.userAgent).slice(0, 300),
    description: desc.text,
    roomSnapshot: snap.text,
    replay: replay.text,
    recentErrors: errors.text,
    truncated: desc.truncated || snap.truncated || replay.truncated || errors.truncated,
  };
}
