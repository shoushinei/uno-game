// ========================================
// 画面を消させない（Screen Wake Lock API）
//
// 3〜8人＋手番の持ち時間60秒なので、他人の番を待っている間に端末が
// 自動ロックして画面が暗くなる。ゲーム画面にいる間だけロックを取り、
// 離れたら必ず解放する。
//
// ★このAPIの落とし穴★
// タブが裏に回る／画面がロックされると、ブラウザが sentinel を勝手に
// 解放する。戻ってきたときに取り直さないと二度と効かないので、
// visibilitychange で再取得する必要がある。
//
// 対応: Android(Chrome)、iOS 16.4+（ただしホーム画面PWA内では長らく
// 壊れており、Appleが直したのは iOS 18.4）。未対応でも何も起きないだけ。
// ========================================

// 型定義が無い環境（tsconfig の lib 次第）でも通るように最小限で受ける
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

let sentinel: WakeLockSentinelLike | null = null;
/** いま画面を点けたままにしたいか（ゲーム画面にいるか） */
let wanted = false;
let installed = false;

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function acquire(): Promise<void> {
  if (!supported() || !wanted || sentinel) return;
  // 画面が見えていないと必ず失敗するので、そもそも要求しない
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    const s = await (navigator as any).wakeLock.request('screen') as WakeLockSentinelLike;
    sentinel = s;
    // OS側の都合（省電力モードなど）で解放されることがある。参照を捨てておき、
    // 次に visibilitychange が来たときに取り直せるようにする
    s.addEventListener('release', () => { if (sentinel === s) sentinel = null; });
  } catch {
    // バッテリー残量が少ない等で NotAllowedError が飛ぶ。諦めてよい
    sentinel = null;
  }
}

function releaseNow(): void {
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) s.release().catch(() => { /* 無視 */ });
}

/**
 * 画面を点けたままにしたいかを設定する。
 * ui-render.ts の show() から、ゲーム画面のときだけ true で呼ぶ。
 */
export function setWakeLockWanted(on: boolean): void {
  if (!supported()) return;
  if (wanted === on) return;
  wanted = on;
  if (on) {
    installListener();
    void acquire();
  } else {
    releaseNow();
  }
}

/** 裏に回って解放された後、戻ってきたら取り直す */
function installListener(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
  });
}

/** 現在ロックを保持しているか（検証用） */
export function isWakeLockHeld(): boolean {
  return sentinel !== null && !sentinel.released;
}
