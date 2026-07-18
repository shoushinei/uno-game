// ========================================
// 実績解除トースト（Phase 3）
//
// ログイン中のユーザーの users/{uid} を購読し、新しく解除された実績を
// 画面上部にトーストで知らせる。主にゲーム終了直後（Cloud Functions が
// 実績を書き込んだ瞬間）に発火するが、対人リアクション初送信のような
// クライアント記録の解除でも出る。
//
// 「新しく解除された」の判定は localStorage の既読集合との差分で行う:
// - 既読集合が未作成のデバイスでは、初回スナップショットを既読として
//   静かに取り込む（過去の実績を一斉にトーストしない）
// - 以降のスナップショットで増えたIDだけをトーストする
// ========================================
import { listenUserAchievements } from '../account.js';
import { achievementMeta } from '../achievements.js';

let unsub: (() => void) | null = null;
let watchingUid: string | null = null;

function seenKey(uid: string): string { return 'seenAchv:' + uid; }

function loadSeen(uid: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(uid));
    const arr = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(arr) ? arr.filter((x: unknown) => typeof x === 'string') : []);
  } catch { return new Set(); }
}
function saveSeen(uid: string, seen: Set<string>): void {
  try { localStorage.setItem(seenKey(uid), JSON.stringify([...seen])); } catch { /* 無視 */ }
}
/** そのデバイスで一度でも既読集合を保存したことがあるか（初回ベースライン判定用） */
function hasSeenRecord(uid: string): boolean {
  try { return localStorage.getItem(seenKey(uid)) !== null; } catch { return false; }
}

/** 解除済みIDの集合を snapshot データから作る（reaction-first はクライアント記録） */
function unlockedIds(data: { achievements: Record<string, number>; reactedFirstAt: number | null }): string[] {
  const ids = Object.keys(data.achievements || {});
  if (typeof data.reactedFirstAt === 'number') ids.push('reaction-first');
  return ids;
}

/** ログイン中（非ゲスト）のユーザーの実績解除の監視を開始する */
export function startAchievementWatch(uid: string): void {
  if (watchingUid === uid) return;
  stopAchievementWatch();
  watchingUid = uid;

  // このデバイスで初めてなら、最初のスナップショットは静かにベースライン化
  let baseline = !hasSeenRecord(uid);

  unsub = listenUserAchievements(uid, (data) => {
    const ids = unlockedIds(data);
    const seen = loadSeen(uid);
    if (baseline) {
      baseline = false;
      for (const id of ids) seen.add(id);
      saveSeen(uid, seen);
      return;
    }
    const fresh = ids.filter(id => !seen.has(id));
    for (const id of fresh) {
      seen.add(id);
      showAchievementToast(id);
    }
    if (fresh.length > 0) saveSeen(uid, seen);
  });
}

export function stopAchievementWatch(): void {
  if (unsub) { unsub(); unsub = null; }
  watchingUid = null;
}

let toastHost: HTMLElement | null = null;
function ensureHost(): HTMLElement {
  if (toastHost && document.body.contains(toastHost)) return toastHost;
  toastHost = document.createElement('div');
  toastHost.className = 'achv-toast-host';
  document.body.appendChild(toastHost);
  return toastHost;
}

/** 実績解除トーストを1件出す（複数同時解除は縦に積む） */
export function showAchievementToast(id: string): void {
  const meta = achievementMeta(id);
  if (!meta) return;
  const host = ensureHost();
  const el = document.createElement('div');
  el.className = 'achv-toast';
  el.innerHTML =
    `<span class="achv-toast-emoji">${meta.emoji}</span>` +
    `<span class="achv-toast-text"><b>実績解除！</b><br>${meta.name}</span>`;
  host.appendChild(el);
  // アニメーション後に自動で消す
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 400);
  }, 3600);
}
