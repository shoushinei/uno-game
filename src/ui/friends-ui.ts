// ========================================
// フレンド画面（Phase 4・承認制）
//
// アカウント状態欄の「🤝」からモーダルを開く。中身:
//  - 自分のフレンドコード（相手に伝えてもらう用）
//  - コード入力で申請 ／ 直近一緒に遊んだ人に「＋申請」
//  - 受信した申請（承認 / 拒否）※拒否は相手に通知せず静かに消える
//  - 送信中の申請（取消）
//  - フレンド一覧（解除）
//
// フレンド関係は listenFriendships でリアルタイム購読し、未処理申請数を
// 状態欄のバッジに出す。
// ========================================
import { auth } from '../firebase-config.js';
import {
  listenFriendships, ensureFriendCode, resolveFriendCode, sendFriendRequest,
  acceptFriend, removeFriendship, fetchNames, recentCoPlayers,
  type Friendship,
} from '../friends.js';

declare global {
  interface Window {
    openFriends: () => Promise<void>;
    closeFriends: (event?: Event) => void;
    sendFriendByCode: () => Promise<void>;
    sendFriendToRecent: (uid: string, name: string) => Promise<void>;
    acceptFriendReq: (pairId: string) => Promise<void>;
    rejectFriendReq: (pairId: string) => Promise<void>;
    cancelFriendReq: (pairId: string) => Promise<void>;
    unfriend: (pairId: string) => Promise<void>;
  }
}

let unsub: (() => void) | null = null;
let watchingUid: string | null = null;
let friendships: Friendship[] = [];
let names: Record<string, string> = {};
let myFriendCode: string | null = null;
let recent: { uid: string; name: string }[] = [];

function myUid(): string { return auth.currentUser?.uid ?? ''; }
function isModalOpen(): boolean {
  const m = document.getElementById('friends-modal');
  return !!m && m.style.display !== 'none' && m.style.display !== '';
}

/** 受信した未処理申請の数（相手→自分・pending） */
export function incomingCount(): number {
  const me = myUid();
  return friendships.filter(f => f.status === 'pending' && f.requestedBy !== me).length;
}

function updateBadge(): void {
  const badge = document.getElementById('friends-badge');
  if (!badge) return;
  const n = incomingCount();
  badge.textContent = String(n);
  badge.style.display = n > 0 ? 'flex' : 'none';
}

/** ログイン中（非ゲスト）のフレンド購読を開始する */
export function startFriendsWatch(uid: string): void {
  if (watchingUid === uid) return;
  stopFriendsWatch();
  watchingUid = uid;
  unsub = listenFriendships(uid, async (list) => {
    friendships = list;
    // 表示名をまとめて取得（相手側のuidのみ）
    const others = [...new Set(list.flatMap(f => f.members).filter(u => u !== uid))];
    const missing = others.filter(u => !(u in names));
    if (missing.length) Object.assign(names, await fetchNames(missing));
    updateBadge();
    if (isModalOpen()) renderFriends();
  });
}

export function stopFriendsWatch(): void {
  if (unsub) { unsub(); unsub = null; }
  watchingUid = null;
  friendships = [];
  const badge = document.getElementById('friends-badge');
  if (badge) badge.style.display = 'none';
}

window.openFriends = async () => {
  const modal = document.getElementById('friends-modal');
  const body = document.getElementById('friends-body');
  if (!modal || !body) return;
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    modal.style.display = 'flex';
    body.innerHTML = '<p class="profile-note">フレンド機能はアカウントが必要です</p>';
    return;
  }
  modal.style.display = 'flex';
  body.innerHTML = '<p class="profile-note">読み込み中...</p>';
  // フレンドコードと直近プレイヤーを取得（並行）
  const [code, rec] = await Promise.all([ensureFriendCode(user.uid), recentCoPlayers(user.uid)]);
  myFriendCode = code;
  recent = rec;
  renderFriends();
};

window.closeFriends = () => {
  const modal = document.getElementById('friends-modal');
  if (modal) modal.style.display = 'none';
};

window.sendFriendByCode = async () => {
  const input = document.getElementById('friend-code-input') as HTMLInputElement | null;
  const code = (input?.value || '').trim().toUpperCase();
  if (code.length < 4) { setFriendMsg('コードを入力してください', true); return; }
  if (code === myFriendCode) { setFriendMsg('自分のコードです', true); return; }
  const target = await resolveFriendCode(code);
  if (!target) { setFriendMsg('そのコードのユーザーが見つかりません', true); return; }
  const r = await sendFriendRequest(myUid(), target);
  if (r.ok) { setFriendMsg('✅ 申請を送りました', false); if (input) input.value = ''; }
  else setFriendMsg(sendErr(r.reason), true);
};

window.sendFriendToRecent = async (uid, name) => {
  const r = await sendFriendRequest(myUid(), uid);
  setFriendMsg(r.ok ? `✅ ${name} に申請を送りました` : sendErr(r.reason), !r.ok);
  if (r.ok) renderFriends();
};

window.acceptFriendReq = async (id) => { await acceptFriend(id); };
window.rejectFriendReq = async (id) => { await removeFriendship(id); };
window.cancelFriendReq = async (id) => { await removeFriendship(id); };
window.unfriend = async (id) => {
  if (!window.confirm('このフレンドを解除しますか？')) return;
  await removeFriendship(id);
};

function sendErr(reason: string): string {
  return reason === 'self' ? '自分には送れません'
    : reason === 'exists' ? 'すでにフレンドです'
    : reason === 'pending' ? 'すでに申請中です'
    : '送信に失敗しました';
}

function setFriendMsg(text: string, isErr: boolean): void {
  const el = document.getElementById('friend-msg');
  if (el) { el.textContent = text; el.className = 'msg' + (isErr ? ' err' : ' ok'); }
}

function nameOf(uid: string): string { return names[uid] ?? 'プレイヤー'; }

function renderFriends(): void {
  const body = document.getElementById('friends-body');
  if (!body) return;
  const me = myUid();
  const incoming = friendships.filter(f => f.status === 'pending' && f.requestedBy !== me);
  const outgoing = friendships.filter(f => f.status === 'pending' && f.requestedBy === me);
  const friends = friendships.filter(f => f.status === 'accepted');
  const other = (f: Friendship) => f.members.find(u => u !== me) ?? '';
  // 既にフレンド/申請中の相手は直近リストから除外
  const relatedUids = new Set(friendships.flatMap(f => f.members));
  const recentToShow = recent.filter(r => !relatedUids.has(r.uid));

  const sec = (title: string, inner: string) => `<div class="profile-sec">${title}</div>${inner}`;
  const row = (name: string, actions: string) =>
    `<div class="friend-row"><span class="friend-name">${name}</span><span class="friend-actions">${actions}</span></div>`;

  const incomingHtml = incoming.length
    ? incoming.map(f => row(nameOf(other(f)),
        `<button class="friend-btn ok" onclick="acceptFriendReq('${f.pairId}')">承認</button>` +
        `<button class="friend-btn" onclick="rejectFriendReq('${f.pairId}')">拒否</button>`)).join('')
    : '<p class="profile-note">なし</p>';

  const friendsHtml = friends.length
    ? friends.map(f => row(nameOf(other(f)),
        `<button class="friend-btn ghost" onclick="unfriend('${f.pairId}')">解除</button>`)).join('')
    : '<p class="profile-note">まだフレンドがいません</p>';

  const outgoingHtml = outgoing.length
    ? outgoing.map(f => row(nameOf(other(f)) + ' <span class="friend-pending">申請中</span>',
        `<button class="friend-btn ghost" onclick="cancelFriendReq('${f.pairId}')">取消</button>`)).join('')
    : '';

  const recentHtml = recentToShow.length
    ? recentToShow.map(r => row(r.name,
        `<button class="friend-btn ok" onclick="sendFriendToRecent('${r.uid}','${r.name.replace(/'/g, '')}')">＋申請</button>`)).join('')
    : '<p class="profile-note">直近で一緒に遊んだ人はいません</p>';

  body.innerHTML = `
    <div class="friend-code-box">
      あなたのフレンドコード<br>
      <span class="friend-code">${myFriendCode ?? '------'}</span>
    </div>
    <div class="friend-add">
      <input id="friend-code-input" placeholder="相手のコードを入力" maxlength="6" style="text-transform:uppercase">
      <button class="btn" onclick="sendFriendByCode()" style="background:#16a085;color:#fff">申請</button>
    </div>
    <p class="msg" id="friend-msg"></p>
    ${incoming.length ? sec(`受信した申請 (${incoming.length})`, incomingHtml) : ''}
    ${sec('フレンド', friendsHtml)}
    ${outgoing.length ? sec('送信中の申請', outgoingHtml) : ''}
    ${sec('最近遊んだ人', recentHtml)}
  `;
}
