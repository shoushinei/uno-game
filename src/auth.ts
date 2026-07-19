// ========================================
// 認証・ルーム管理
// Google認証とルームのCRUD操作を担う。
// ゲームロジックには依存しない。
// ========================================
import { state, newRoomId, randomGuestName } from './state.js';
import { fbGet, fbSet, fbUpdate, testConnection } from './db.js';
import { canAddBot, canRemoveBot, canKickPlayer, makeBotPlayer } from './bot/lobby-bots.js';
import { auth, googleProvider } from './firebase-config.js';
import {
  signInWithPopup,
  signInAnonymously,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { ensureUserDoc, saveDisplayName } from './account.js';
import { startAchievementWatch, stopAchievementWatch } from './ui/achievement-toast.js';
import { setAccountBarName, syncAccountBar } from './ui/account-bar.js';
import { startFriendsWatch, stopFriendsWatch } from './ui/friends-ui.js';
import { startPresence, stopPresence, setPresenceRoom } from './presence.js';
import { show, setHomeMsg, setLobbyMsg, setStatus, dbg, setLoading } from './ui/ui-render.js';

// window オブジェクトに生やす関数の型宣言
// （index.html の onclick="..." から呼ばれるため window に公開する必要がある。
//   _startListening / _stopListening は app.js 側が登録するので optional にする）
declare global {
  interface Window {
    createRoom: () => Promise<void>;
    joinRoom: () => Promise<void>;
    toggleReady: () => Promise<void>;
    addBot: () => Promise<void>;
    removeBot: (botId: string) => Promise<void>;
    kickPlayer: (playerId: string) => Promise<void>;
    backToLobby: () => Promise<void>;
    leaveGame: () => Promise<void>;
    _startListening?: () => void;
    _stopListening?: () => void;
  }
}

// ----------------------------------------
// ログイン（Google / ゲスト）
//
// ★Phase 1（アカウント基盤）★
// - Googleログイン = アカウントあり（Firestore users/{uid} を自動作成）
// - ゲスト = Firebaseの匿名認証。uidは付くがアカウント機能は一切なし。
//   後からGoogleログインしても戦績等の引き継ぎはしない（合意済みの仕様）
// ----------------------------------------

/** Firestoreに保存済みの表示名（ログイン時に読み込み。ゲスト・未取得は null） */
let savedProfileName: string | null = null;

/** ゲストセッション中の表示名（初回に1度だけ生成して使い回す） */
let guestName: string | null = null;

async function loginWithGoogle(): Promise<void> {
  try {
    setStatus('Google ログイン画面を起動中...');
    await signInWithPopup(auth, googleProvider);
  } catch (e: any) {
    setHomeMsg('ログイン失敗: ' + e.message);
    setStatus('ログインエラー', 'err');
    dbg('Googleログイン失敗: ' + e.message, true);
  }
}

const loginButton = document.getElementById('login-btn');
if (loginButton) loginButton.addEventListener('click', () => void loginWithGoogle());

const guestButton = document.getElementById('guest-login-btn');
if (guestButton) {
  guestButton.addEventListener('click', async () => {
    try {
      setStatus('ゲストとして開始中...');
      await signInAnonymously(auth);
    } catch (e: any) {
      // admin-restricted-operation / operation-not-allowed は
      // 「コンソールで匿名認証プロバイダが未有効」のときの定番エラー
      const notEnabled = e?.code === 'auth/admin-restricted-operation' ||
                         e?.code === 'auth/operation-not-allowed';
      setHomeMsg(notEnabled
        ? 'ゲストプレイは現在準備中です。Googleアカウントでログインしてください'
        : 'ゲスト開始に失敗: ' + e.message);
      setStatus('ログインエラー', 'err');
      dbg('匿名ログイン失敗: ' + (e.code ?? e.message), true);
    }
  });
}

// ゲスト中に「Googleアカウントに切り替える」ボタン（アカウント機能を使いたくなったら）
const upgradeButton = document.getElementById('guest-to-google-btn');
if (upgradeButton) upgradeButton.addEventListener('click', () => void loginWithGoogle());

// ----------------------------------------
// メールリンク認証（Phase 1.5）
//
// パスワードレスの第3の入り口。メールアドレスにログインリンクを送り、
// リンクを踏むとログイン完了（1メールアドレス=1アカウント）。
// Googleアカウントと同じメールアドレスの場合は同じアカウントに入る
// （Firebaseの既定「1メールアドレス=1アカウント」設定のまま＝本人なら
//   入り口が違っても戦績が分かれない、を意図した仕様）。
// ----------------------------------------

/** リンクを踏んで戻ってきたときにメールアドレスを照合するための保存キー */
const EMAIL_LS_KEY = 'emailForSignIn';

function setEmailMsg(text: string, isErr = false): void {
  const el = document.getElementById('email-msg');
  if (el) {
    el.textContent = text;
    el.className = 'msg' + (isErr ? ' err' : '');
  }
}

const emailButton = document.getElementById('email-login-btn');
if (emailButton) {
  emailButton.addEventListener('click', async () => {
    const input = document.getElementById('email-input') as HTMLInputElement | null;
    const email = (input?.value || '').trim();
    if (!email || !email.includes('@') || email.length < 5) {
      setEmailMsg('メールアドレスを入力してください', true);
      return;
    }
    try {
      setStatus('ログインリンクを送信中...');
      await sendSignInLinkToEmail(auth, email, {
        // 戻り先は今開いているページ（GitHub Pagesの /uno-game/ もローカルも同じ式でOK）
        url: location.origin + location.pathname,
        handleCodeInApp: true,
      });
      localStorage.setItem(EMAIL_LS_KEY, email);
      setEmailMsg('✉️ ログインリンクを送信しました。メールのリンクを開いてください（届かない場合は迷惑メールフォルダも確認）');
      setStatus('メールを確認してください', 'ok');
    } catch (e: any) {
      const notEnabled = e?.code === 'auth/operation-not-allowed' ||
                         e?.code === 'auth/admin-restricted-operation';
      setEmailMsg(
        notEnabled ? 'メールリンクログインは現在準備中です'
        : e?.code === 'auth/invalid-email' ? 'メールアドレスの形式が正しくありません'
        : e?.code === 'auth/too-many-requests' ? '送信が多すぎます。しばらく待ってから再試行してください'
        : '送信に失敗: ' + e.message,
        true
      );
      setStatus('ログインエラー', 'err');
      dbg('メールリンク送信失敗: ' + (e.code ?? e.message), true);
    }
  });
}

/**
 * メールのリンクを踏んでページに戻ってきたときのログイン完了処理
 * （モジュール読み込み時に1回だけ判定。通常アクセスでは何もしない）。
 */
async function completeEmailLinkSignIn(): Promise<void> {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  // 送信時に保存したアドレスで照合。別端末でリンクを開いた場合は無いので
  // セキュリティ上、本人に再入力してもらう
  let email = localStorage.getItem(EMAIL_LS_KEY);
  if (!email) {
    email = window.prompt('確認のため、ログインに使ったメールアドレスを入力してください') || '';
  }
  try {
    if (!email) {
      setHomeMsg('メールアドレスが確認できなかったためログインを中止しました');
      return;
    }
    setStatus('メールリンクでログイン中...');
    await signInWithEmailLink(auth, email, location.href);
    localStorage.removeItem(EMAIL_LS_KEY);
    dbg('メールリンクログイン成功');
  } catch (e: any) {
    setHomeMsg(
      e?.code === 'auth/invalid-action-code'
        ? 'ログインリンクが無効です（使用済みか期限切れ）。もう一度送信してください'
        : 'メールリンクログインに失敗: ' + e.message
    );
    setStatus('ログインエラー', 'err');
    dbg('メールリンクログイン失敗: ' + (e.code ?? e.message), true);
  } finally {
    // リンクのパラメータをURLから消す（リロード時の再処理・履歴共有事故を防ぐ）
    history.replaceState(null, '', location.pathname);
  }
}
void completeEmailLinkSignIn();

onAuthStateChanged(auth, async (user: any) => {
  const loginArea    = document.getElementById('login-area');
  const gameMenuArea = document.getElementById('game-menu-area');
  const upgradeBtn   = document.getElementById('guest-to-google-btn');
  const niInput      = document.getElementById('ni') as HTMLInputElement | null;
  if (user) {
    const isGuest = !!user.isAnonymous;
    dbg(isGuest ? 'ゲストとして開始: ' + user.uid : 'ログイン成功: ' + (user.displayName || user.email || user.uid));
    if (loginArea)    loginArea.style.display    = 'none';
    if (gameMenuArea) gameMenuArea.style.display = 'block';
    // ゲストにだけ「Googleアカウントに切り替える」導線を出す
    if (upgradeBtn) upgradeBtn.style.display = isGuest ? 'block' : 'none';
    // プロフィール（戦績・実績）は右上のアカウント状態欄からのみ開く
    // （ホーム画面のボタンは廃止済み）

    // ★Phase 1★ アカウントあり（Google/メールリンク）のユーザーはプロフィール
    // （users/{uid}）を自動作成/取得し、保存済みの表示名を名前欄にプリフィル
    // する（毎回入力の廃止）。ゲストはアカウントを作らず従来どおり入力。
    // メールリンクユーザーは displayName が無いので、メールの@より前を初期名にする。
    savedProfileName = null;
    state.myIcon = null;
    state.myTitle = null;
    let prefill: string;
    if (isGuest) {
      // ゲストは「ゲスト+乱数」の名前を1度だけ生成して使い回す
      // （onAuthStateChanged が再発火しても名前が変わらないように）
      if (!guestName) guestName = randomGuestName();
      prefill = guestName;
    } else {
      guestName = null;
      const defaultName: string =
        (user.displayName || (user.email ? user.email.split('@')[0] : '') || 'プレイヤー').slice(0, 12);
      const profile = await ensureUserDoc({ uid: user.uid, displayName: defaultName, isAnonymous: false });
      savedProfileName = profile?.displayName ?? null;
      prefill = savedProfileName || defaultName;
      // ★Phase 5★ 選択中のアイコン・称号を保持（ルーム参加時に配る／状態欄表示）
      state.myIcon = profile?.selectedIcon ?? null;
      state.myTitle = profile?.selectedTitle ?? null;
    }
    if (niInput) niInput.value = prefill;

    // アカウント状態欄（右上チップ）に名前を反映して表示する
    setAccountBarName(prefill);

    // ★Phase 3/4★ 実績トースト・フレンド監視・在席（アカウント保持者のみ）
    if (isGuest) { stopAchievementWatch(); stopFriendsWatch(); stopPresence(); }
    else {
      startAchievementWatch(user.uid);
      startFriendsWatch(user.uid);
      startPresence(user.uid);
      // 既にルームに居る状態でログインが確定した場合は在席にルームを反映
      if (state.roomId) setPresenceRoom(state.roomId);
    }

    setStatus('Firebase 接続テスト中...');
    const ok = await testConnection();
    if (ok) {
      setStatus(isGuest ? 'ゲストでプレイ中（アカウント機能なし）' : `ログイン中: ${prefill} ✓`, 'ok');
      dbg('Firebase 接続成功');

      // LocalStorageによるセッション復帰チェック
      // ★Phase 1★ プレイヤーID=認証uidになったため、保存IDが今のuidと
      // 一致する場合だけ復帰する（別アカウントでログインし直した場合や
      // 旧ランダムID時代のセッションは復帰させない）
      const savedRoomId = localStorage.getItem('savedRoomId');
      const savedMyId   = localStorage.getItem('savedMyId');
      if (savedRoomId && savedMyId && savedMyId === user.uid) {
        try {
          setStatus('前のルームに復帰中...');
          const room = await fbGet('rooms/' + savedRoomId);
          // ルームが存在し、自分がまだプレイヤーリストに残っていれば復帰
          if (room && room.players && room.players.some((p: any) => p.id === savedMyId)) {
            state.roomId = savedRoomId;
            state.myId   = savedMyId;
            state.myName = localStorage.getItem('savedMyName') || 'ゲスト';
            state.isHost = localStorage.getItem('savedIsHost') === 'true';

            // ★Phase C3★ 退室（代行残留）していた席に戻ってきた場合は、
            // leftPlayers / autoPlayers から自分を外して操作を取り戻す
            if ((room.leftPlayers && room.leftPlayers[savedMyId]) ||
                (room.autoPlayers && room.autoPlayers[savedMyId])) {
              try {
                await fbUpdate('rooms/' + savedRoomId, {
                  [`leftPlayers/${savedMyId}`]: null,
                  [`autoPlayers/${savedMyId}`]: null,
                });
                dbg('退室していた席に復帰しました: ' + savedRoomId);
              } catch { /* 失敗しても復帰自体は続行 */ }
            }

            document.getElementById('lrid')!.textContent = state.roomId;

            // 部屋の状態に合わせて直接画面を切り替える
            if (room.state === 'lobby') {
              show('lobby');
            } else if (room.state === 'playing') {
              show('game');
            } else if (room.state === 'ended') {
              show('result');
            }

            window._startListening?.();
            dbg('セッション復帰成功: ' + state.roomId);
            // ★バグ修正：ここで「前のルームに復帰中...」のまま
            // ステータス表示が固定されてしまい、後で leaveGame() 等で
            // ホーム画面に戻った際にそのまま表示され続けてしまっていた。
            // 復帰成功後は通常のログイン成功メッセージに更新する。
            setStatus(isGuest ? 'ゲストでプレイ中（アカウント機能なし）' : `ログイン中: ${prefill} ✓`, 'ok');
            if (gameMenuArea) gameMenuArea.style.display = 'none';
            return; // 復帰した場合は通常のホームメニュー表示をスキップ
          } else {
            // 部屋が消滅しているか自分がいない場合はストレージをクリア
            localStorage.removeItem('savedRoomId');
            localStorage.removeItem('savedMyId');
            localStorage.removeItem('savedMyName');
            localStorage.removeItem('savedIsHost');
          }
        } catch (e: any) {
          dbg('自動復帰エラー: ' + e.message, true);
        }
      }
    } else {
      setStatus('接続エラー — データベースへのアクセス権限がありません', 'err');
      dbg('Firebase 接続失敗', true);
    }
  } else {
    if (loginArea)    loginArea.style.display    = 'block';
    if (gameMenuArea) gameMenuArea.style.display = 'none';
    setStatus('Googleアカウントでログインしてください');
    dbg('未ログイン状態');
    stopAchievementWatch();
    stopFriendsWatch();
    stopPresence();
    setAccountBarName('');
    syncAccountBar(); // ログアウトでチップを隠す
  }
});

// ★Phase 5★ players[] へ埋め込むアイコン・称号を作る。
// Realtime Database は undefined を拒否するため、設定済みのキーだけ返す。
function myCosmetics(): { icon?: string; title?: string } {
  const c: { icon?: string; title?: string } = {};
  if (state.myIcon) c.icon = state.myIcon;
  if (state.myTitle) c.title = state.myTitle;
  return c;
}

// ----------------------------------------
// ルーム作成
// ----------------------------------------
window.createRoom = async function () {
  const nm = (document.getElementById('ni') as HTMLInputElement).value.trim();
  if (!nm) { setHomeMsg('名前を入力してください'); return; }
  const user = auth.currentUser;
  if (!user) { setHomeMsg('ログインしてください'); return; }
  setHomeMsg('');
  setLoading('create-btn', true, '作成中');
  try {
    const ok = await testConnection();
    if (!ok) { setHomeMsg('Firebase 接続に失敗しました'); return; }
    // ★Phase 1★ プレイヤーID＝Firebase Authのuid（同一アカウント=同一ID）
    state.myName = nm;
    state.myId   = user.uid;
    state.isHost = true;
    state.roomId = newRoomId();
    // Googleユーザーが名前を変えていたらプロフィールにも保存（次回から新しい名前）
    if (!user.isAnonymous && nm !== savedProfileName) {
      savedProfileName = nm;
      void saveDisplayName(user.uid, nm);
    }
    const room = {
      state: 'lobby', host: state.myId,
      players: [{ id: state.myId, name: state.myName, bi: 0, ready: true, ...myCosmetics() }],
      game: null, log: [], ts: Date.now(), reactions: {}, trumpPassCount: 0,
    };
    await fbSet('rooms/' + state.roomId, room);

    // LocalStorageにセッション情報を保存
    localStorage.setItem('savedRoomId', state.roomId);
    localStorage.setItem('savedMyId', state.myId);
    localStorage.setItem('savedMyName', state.myName);
    localStorage.setItem('savedIsHost', String(state.isHost));

    document.getElementById('lrid')!.textContent = state.roomId;
    show('lobby');
    window._startListening?.();
    dbg('ルーム作成: ' + state.roomId);
  } catch (e: any) {
    setHomeMsg('エラー: ' + e.message);
    dbg('createRoom error: ' + e.message, true);
  } finally {
    setLoading('create-btn', false, '新しいルームを作る');
  }
};

// ----------------------------------------
// ルーム参加
// ----------------------------------------
window.joinRoom = async function () {
  const nm  = (document.getElementById('ni') as HTMLInputElement).value.trim();
  const rid = (document.getElementById('ri') as HTMLInputElement).value.trim().toUpperCase();
  if (!nm)              { setHomeMsg('名前を入力してください'); return; }
  if (rid.length !== 4) { setHomeMsg('4文字のルームIDを入力してください'); return; }
  setHomeMsg('');
  setLoading('join-btn', true, '参加中');
  const user = auth.currentUser;
  if (!user) { setHomeMsg('ログインしてください'); return; }
  try {
    const room = await fbGet('rooms/' + rid);
    if (!room) { setHomeMsg('ルームが見つかりません'); return; }
    const players: any[] = room.players || [];

    // ★Phase 1★ 同一アカウントの再入室＝元の席への復帰。
    // プレイヤーID=認証uidになったため、別端末や再ログインでも
    // ルームIDさえ入力すれば自分の席に戻れる（ゲーム中でも可）。
    const mySeat = players.find(p => p.id === user.uid);
    if (mySeat) {
      state.myName = mySeat.name;
      state.myId   = user.uid;
      state.isHost = (room.host === user.uid);
      state.roomId = rid;
      // 退室（代行残留）していた場合は代行を解除して操作を取り戻す
      if ((room.leftPlayers && room.leftPlayers[user.uid]) ||
          (room.autoPlayers && room.autoPlayers[user.uid])) {
        try {
          await fbUpdate('rooms/' + rid, {
            [`leftPlayers/${user.uid}`]: null,
            [`autoPlayers/${user.uid}`]: null,
          });
        } catch { /* 失敗しても復帰自体は続行 */ }
      }
      localStorage.setItem('savedRoomId', state.roomId);
      localStorage.setItem('savedMyId', state.myId);
      localStorage.setItem('savedMyName', state.myName);
      localStorage.setItem('savedIsHost', String(state.isHost));
      document.getElementById('lrid')!.textContent = state.roomId;
      if (room.state === 'playing') show('game');
      else if (room.state === 'ended') show('result');
      else show('lobby');
      window._startListening?.();
      dbg('自分の席へ復帰: ' + rid);
      return;
    }

    if (room.state !== 'lobby') { setHomeMsg('ゲームはすでに始まっています'); return; }
    if (players.length >= 8)              { setHomeMsg('このルームは満員です（最大8人）'); return; }
    if (players.find(p => p.name === nm)) { setHomeMsg('この名前はすでに使われています'); return; }
    state.myName = nm;
    state.myId   = user.uid;
    state.isHost = false;
    state.roomId = rid;
    players.push({ id: state.myId, name: state.myName, bi: players.length, ready: false, ...myCosmetics() });
    await fbUpdate('rooms/' + rid, { players });
    // Googleユーザーが名前を変えていたらプロフィールにも保存
    if (!user.isAnonymous && nm !== savedProfileName) {
      savedProfileName = nm;
      void saveDisplayName(user.uid, nm);
    }

    // LocalStorageにセッション情報を保存
    localStorage.setItem('savedRoomId', state.roomId);
    localStorage.setItem('savedMyId', state.myId);
    localStorage.setItem('savedMyName', state.myName);
    localStorage.setItem('savedIsHost', String(state.isHost));

    document.getElementById('lrid')!.textContent = state.roomId;
    show('lobby');
    window._startListening?.();
    dbg('参加完了: ' + rid);
  } catch (e: any) {
    setHomeMsg('エラー: ' + e.message);
    dbg('joinRoom error: ' + e.message, true);
  } finally {
    setLoading('join-btn', false, 'ルームに参加する');
  }
};

// ----------------------------------------
// 準備完了トグル
// ----------------------------------------
window.toggleReady = async function () {
  try {
    const room    = await fbGet('rooms/' + state.roomId);
    if (!room) return;
    const players: any[] = room.players || [];
    const me      = players.find(p => p.id === state.myId);
    if (me) {
      me.ready = !me.ready;
      await fbUpdate('rooms/' + state.roomId, { players });
    }
  } catch (e: any) { dbg('toggleReady error: ' + e.message, true); }
};

// ----------------------------------------
// ボットの追加／削除（ホストのみ・ロビー中のみ）
//
// ボットは players 配列の普通のプレイヤー（isBot: true, ready: true）として
// 追加する。手番はゲーム開始後、ホストのクライアントが absent-runner で
// 代行実行する（退室者と同じ仕組み）。
// ----------------------------------------
window.addBot = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId);
    if (!canAddBot(room, state.myId)) {
      setLobbyMsg('ボットを追加できません（ホストのみ・最大8人）');
      return;
    }
    const players: any[] = room.players || [];
    const bot = makeBotPlayer(players);
    players.push(bot);
    await fbUpdate('rooms/' + state.roomId, { players });
    dbg('ボット追加: ' + bot.name);
  } catch (e: any) { dbg('addBot error: ' + e.message, true); }
};

window.removeBot = async function (botId: string) {
  try {
    const room = await fbGet('rooms/' + state.roomId);
    if (!canRemoveBot(room, state.myId, botId)) return;
    const players: any[] = (room.players || []).filter((p: any) => p.id !== botId);
    await fbUpdate('rooms/' + state.roomId, { players });
    dbg('ボット削除: ' + botId);
  } catch (e: any) { dbg('removeBot error: ' + e.message, true); }
};

// ----------------------------------------
// プレイヤーのキック（ホストのみ・ロビー中のみ）
//
// 人間プレイヤーを追い出すのは重い操作なので、ボット削除と違い
// 確認ダイアログを挟む。追い出された側は自分が players から消えたことを
// リスナーで検知してホーム画面へ戻る（app.ts）。
// ----------------------------------------
window.kickPlayer = async function (playerId: string) {
  try {
    const room = await fbGet('rooms/' + state.roomId);
    if (!canKickPlayer(room, state.myId, playerId)) return;
    const target = (room.players || []).find((p: any) => p.id === playerId);
    const ok = window.confirm(`本当に「${target?.name ?? '?'}」をロビーから追い出しますか？`);
    if (!ok) return;
    const players: any[] = (room.players || []).filter((p: any) => p.id !== playerId);
    await fbUpdate('rooms/' + state.roomId, { players });
    dbg('プレイヤーをキック: ' + (target?.name ?? playerId));
  } catch (e: any) { dbg('kickPlayer error: ' + e.message, true); }
};

// ----------------------------------------
// lobbyへ戻る
// ----------------------------------------
window.backToLobby = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId);
    if (!room) return;

    // ★修正：まだ誰も部屋をリセットしていない場合のみ、Firebaseを初期化する
    if (room.state !== 'lobby') {
      // ホストは自動でready、ボットは常にready。人間の参加者だけ準備待ちに戻す
      const players = (room.players || []).map((p: any) => ({ ...p, ready: p.isBot || p.id === room.host }));
      await fbUpdate('rooms/' + state.roomId, {
        state: 'lobby', game: null, log: [], players, reactions: {}, trumpPassCount: 0,
        // ★修正★ 自動プレイ(autoPlayers)を次のゲームへ引き継がないよう、
        // ロビーに戻る時点でリセットする（各クライアントはゲーム終了時に
        // 自分の分をOFFにするが、ここでも念のためまとめてクリアする）。
        autoPlayers: null,
        // ★リプレイ機能で追加★
        // ロビーに戻るタイミングで、前のゲームのリプレイ用データ（配り終わった
        // 直後の状態・操作履歴）は不要になるので、放置してストレージに
        // 残り続けないよう明示的に消す（保存したい場合は事前にリザルト画面の
        // 「📼 リプレイを保存」ボタンでダウンロードしておく必要がある）。
        actionLog: null,
        replayInitialState: null,
      });
    }

    // 全員共通：自分の画面をロビーに切り替えて、リスナーを再始動する
    show('lobby');
    window._startListening?.();
  } catch (e: any) { dbg('backToLobby error: ' + e.message, true); }
};

// ----------------------------------------
// セッション情報とメモリ上の状態を消してホームへ戻る共通処理
// （app.ts のキック検知からも使うため export）
// ----------------------------------------
export function clearSessionAndGoHome(): void {
  localStorage.removeItem('savedRoomId');
  localStorage.removeItem('savedMyId');
  localStorage.removeItem('savedMyName');
  localStorage.removeItem('savedIsHost');
  state.roomId = '';
  state.myId = '';
  state.myName = '';
  state.isHost = false;
  setPresenceRoom(null); // ルームを離れたので在席は「オンライン」へ
  show('home');
}

// ----------------------------------------
// 退出
//
// ・ロビー中／ゲーム終了後：従来どおり players から削除（無人なら部屋削除）
// ・ゲーム進行中：★Phase C3★ players からは削除せず leftPlayers + autoPlayers に
//   登録して「退室中（自動）」として席を残す。手番はホストのクライアントが
//   代行実行する（absent-runner, C4）。localStorage のセッション情報は保持し、
//   同じ端末で再アクセスすれば元の席に復帰できる。
// ----------------------------------------
window.leaveGame = async function () {
  const rid  = state.roomId;
  const myId = state.myId;

  let room: any = null;
  if (rid && myId) {
    try { room = await fbGet('rooms/' + rid); } catch { room = null; }
  }
  const isPlaying = room?.state === 'playing';

  // ゲーム進行中の退室は、代行に引き継ぐ旨を確認してから実行する
  if (isPlaying) {
    const ok = window.confirm(
      'ゲームの途中です。退室すると、あなたの手番はボットが自動でプレイします。\n' +
      '同じ端末で再度アクセスすれば、元の席に戻って続きをプレイできます。\n\n退室しますか？'
    );
    if (!ok) return; // キャンセル：何もしない
  }

  window._stopListening?.();

  if (rid && myId && room && room.players) {
    try {
      if (isPlaying) {
        // ---- 代行残留 ----
        const leftPlayers = { ...(room.leftPlayers || {}), [myId]: true };
        const autoPlayers = { ...(room.autoPlayers || {}), [myId]: true };

        // 人間が全員退室したら、ボットだけの無人試合を続けずに削除する
        // （ボットの手番を代行できるホスト＝人間がもう居ないため）
        const allHumansLeft = room.players
          .filter((p: any) => !p.isBot)
          .every((p: any) => leftPlayers[p.id]);
        if (allHumansLeft) {
          await fbSet('rooms/' + rid, null);
          dbg('人間が全員退室したためルームを削除しました: ' + rid);
        } else {
          const updates: any = { leftPlayers, autoPlayers };
          const myName = room.players.find((p: any) => p.id === myId)?.name ?? 'プレイヤー';
          // ホスト自身が退室する場合、退室していない「人間」へホストを移譲する。
          // ★ボットをホストにしない★（ボットのブラウザは無く、代行実行者が
          //   居なくなって進行が止まるため）。人間が残っていることは
          //   allHumansLeft が false であることで保証されている。
          if (room.host === myId) {
            const nextHost = room.players.find((p: any) => !leftPlayers[p.id] && !p.isBot);
            if (nextHost) {
              updates.host = nextHost.id;
              updates.log = [...(room.log || []), `${nextHost.name} が新しいホストになりました`].slice(-8);
            }
          }
          updates.log = [...(updates.log || room.log || []), `🚪 ${myName} が退室しました（自動プレイで継続）`].slice(-8);
          await fbUpdate('rooms/' + rid, updates);
          dbg('退室（代行残留）: ' + rid);
        }
        // ★localStorageは消さない★（同じ端末での復帰の鍵）。メモリ状態だけ戻す
        state.roomId = '';
        state.myId = '';
        state.myName = '';
        state.isHost = false;
        setPresenceRoom(null); // ゲーム中の退室でも在席は「オンライン」へ
        show('home');
        return;
      }

      // ---- 従来どおりの退出（ロビー中・ゲーム終了後）----
      const remainingPlayers = room.players.filter((p: any) => p.id !== myId);
      const remainingHumans = remainingPlayers.filter((p: any) => !p.isBot);
      // 人間が誰も残らない（無人 or ボットだけ）なら部屋ごと削除する
      if (remainingHumans.length === 0) {
        await fbSet('rooms/' + rid, null);
        dbg('人間が居なくなったためルームを削除しました: ' + rid);
      } else {
        const updates: { players: any[]; host?: string; log?: string[] } = { players: remainingPlayers };
        // ★ホストは人間に移譲する★（ボットをホストにしない）
        if (room.host === myId) {
          updates.host = remainingHumans[0].id;
          const logs = [...(room.log || []), `${remainingHumans[0].name} が新しいホストになりました`];
          updates.log = logs.slice(-8);
        }
        await fbUpdate('rooms/' + rid, updates);
        dbg('ルームから退出しました: ' + rid);
      }
    } catch (e: any) { dbg('退出処理でエラーが発生しました: ' + e.message, true); }
  }

  clearSessionAndGoHome();
};

// ----------------------------------------
// inputオートフォーマット
// ----------------------------------------
(document.getElementById('ri') as HTMLInputElement).addEventListener('input', function () {
  this.value = this.value.toUpperCase();
});
