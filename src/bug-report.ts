// ========================================
// バグ報告のデータ層（🐛 ゲーム内からワンタップ報告）
//
// ユーザーの説明文に加えて、原因調査に必要なデータを自動添付して
// Firestore の bugReports コレクションへ送る:
//  - ルーム/ゲーム状態のスナップショット（window._room）
//  - リプレイデータ（replay/io.ts の buildReplayFile ＝ 初期状態＋全操作ログ。
//    開発者がアプリの再生画面でバグを完全再現できる）
//  - 直近のエラー履歴（リングバッファ・下の installErrorCapture が収集）
//
// セキュリティ: クライアントは「作成のみ可・読み取り不可」（firestore.rules）。
// 開発者は Firebase コンソール（Admin権限）で閲覧する。
// ペイロード組み立て等の純粋部分は bug-report-logic.ts（vitest 対象）。
// ========================================
import { firestore, auth } from './firebase-config.js';
import {
  collection, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from './state.js';
import { buildReplayFile } from './replay/io.js';
import {
  buildBugReportPayload, canSubmit, safeJson, type CapturedError,
} from './bug-report-logic.js';

// ----------------------------------------
// エラー履歴のリングバッファ（直近20件）
// ----------------------------------------
const MAX_ERRORS = 20;
const recentErrors: CapturedError[] = [];
let captureInstalled = false;

function pushError(msg: string): void {
  recentErrors.push({ ts: Date.now(), msg: String(msg).slice(0, 500) });
  if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
}

/**
 * エラー収集を起動時に1回インストールする（二重インストール防止付き）。
 * console.error は必ず元の実装へ委譲する（開発時のログを壊さない）。
 */
export function installErrorCapture(): void {
  if (captureInstalled || typeof window === 'undefined') return;
  captureInstalled = true;
  window.addEventListener('error', (e) => {
    pushError(`[error] ${e.message} @${e.filename ?? '?'}:${e.lineno ?? '?'}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: any = (e as PromiseRejectionEvent).reason;
    pushError(`[unhandledrejection] ${r?.message ?? String(r)}`);
  });
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      pushError('[console.error] ' + args.map(a =>
        typeof a === 'string' ? a : (a instanceof Error ? a.message : safeJson(a).slice(0, 200))
      ).join(' '));
    } catch { /* 収集失敗でログ本体を止めない */ }
    original(...args);
  };
}

/** 収集済みエラーの読み出し */
export function getRecentErrors(): CapturedError[] {
  return [...recentErrors];
}

// ----------------------------------------
// 送信
// ----------------------------------------
let lastSubmitAt = 0;

export type SubmitResult = { ok: true } | { ok: false; reason: 'cooldown' | 'empty' | 'error' };

/** バグ報告を送信する。ルーム外でも説明文だけで送れる */
export async function submitBugReport(description: string): Promise<SubmitResult> {
  const desc = description.trim();
  if (!desc) return { ok: false, reason: 'empty' };
  const now = Date.now();
  if (!canSubmit(now, lastSubmitAt)) return { ok: false, reason: 'cooldown' };

  // リプレイはルーム内でのみ取得を試みる（古いルーム等は null が返る）
  let replay: unknown | null = null;
  try {
    if (state.roomId) replay = await buildReplayFile(state.roomId);
  } catch { replay = null; }

  const payload = buildBugReportPayload({
    description: desc,
    room: (window as any)._room ?? null,
    replay,
    errors: getRecentErrors(),
    uid: auth.currentUser?.uid ?? state.myId ?? '',
    name: state.myName ?? '',
    roomId: state.roomId ?? '',
    uiMode: document.getElementById('s-game-pc')?.classList.contains('active') ? 'pc' : 'classic',
    userAgent: navigator.userAgent,
  });

  try {
    await addDoc(collection(firestore, 'bugReports'), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    lastSubmitAt = now;
    return { ok: true };
  } catch (e) {
    console.warn('バグ報告の送信に失敗:', e);
    return { ok: false, reason: 'error' };
  }
}
