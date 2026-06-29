// ========================================
// 認証・ルーム管理
// Google認証とルームのCRUD操作を担う。
// ゲームロジックには依存しない。
// ========================================
import { state, uid, newRoomId } from './state.js';
import { fbGet, fbSet, fbUpdate, testConnection } from './db.js';
import { auth, googleProvider } from './firebase-config.js';
import { signInWithPopup, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { show, setHomeMsg, setLobbyMsg, setStatus, dbg, setLoading } from './ui-render.js';

// ----------------------------------------
// Google ログイン
// ----------------------------------------
const loginButton = document.getElementById('login-btn');
if (loginButton) {
  loginButton.addEventListener('click', async () => {
    try {
      setStatus('Google ログイン画面を起動中...');
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setHomeMsg('ログイン失敗: ' + e.message);
      setStatus('ログインエラー', 'err');
      dbg('Googleログイン失敗: ' + e.message, true);
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  const loginArea    = document.getElementById('login-area');
  const gameMenuArea = document.getElementById('game-menu-area');
  const niInput      = document.getElementById('ni');
  if (user) {
    dbg('Google ログイン成功: ' + user.displayName);
    if (loginArea)    loginArea.style.display    = 'none';
    if (gameMenuArea) gameMenuArea.style.display = 'block';
    if (niInput)      niInput.value = user.displayName ? user.displayName.slice(0, 12) : 'ゲスト';
    setStatus('Firebase 接続テスト中...');
    const ok = await testConnection();
    if (ok) {
      setStatus(`ログイン中: ${user.displayName} ✓`, 'ok');
      dbg('Firebase 接続成功');

      // LocalStorageによるセッション復帰チェック
      const savedRoomId = localStorage.getItem('savedRoomId');
      const savedMyId   = localStorage.getItem('savedMyId');
      if (savedRoomId && savedMyId) {
        try {
          setStatus('前のルームに復帰中...');
          const room = await fbGet('rooms/' + savedRoomId);
          // ルームが存在し、自分がまだプレイヤーリストに残っていれば復帰
          if (room && room.players && room.players.some(p => p.id === savedMyId)) {
            state.roomId = savedRoomId;
            state.myId   = savedMyId;
            state.myName = localStorage.getItem('savedMyName') || 'ゲスト';
            state.isHost = localStorage.getItem('savedIsHost') === 'true';

            document.getElementById('lrid').textContent = state.roomId;
            
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
            if (gameMenuArea) gameMenuArea.style.display = 'none';
            return; // 復帰した場合は通常のホームメニュー表示をスキップ
          } else {
            // 部屋が消滅しているか自分がいない場合はストレージをクリア
            localStorage.removeItem('savedRoomId');
            localStorage.removeItem('savedMyId');
            localStorage.removeItem('savedMyName');
            localStorage.removeItem('savedIsHost');
          }
        } catch (e) {
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
  }
});

// ----------------------------------------
// ルーム作成
// ----------------------------------------
window.createRoom = async function () {
  const nm = document.getElementById('ni').value.trim();
  if (!nm) { setHomeMsg('名前を入力してください'); return; }
  setHomeMsg('');
  setLoading('create-btn', true, '作成中');
  try {
    const ok = await testConnection();
    if (!ok) { setHomeMsg('Firebase 接続に失敗しました'); return; }
    state.myName = nm;
    state.myId   = uid();
    state.isHost = true;
    state.roomId = newRoomId();
    const room = {
      state: 'lobby', host: state.myId,
      players: [{ id: state.myId, name: state.myName, bi: 0, ready: true }],
      game: null, log: [], ts: Date.now(), reactions: {}, trumpPassCount: 0,
    };
    await fbSet('rooms/' + state.roomId, room);

    // LocalStorageにセッション情報を保存
    localStorage.setItem('savedRoomId', state.roomId);
    localStorage.setItem('savedMyId', state.myId);
    localStorage.setItem('savedMyName', state.myName);
    localStorage.setItem('savedIsHost', String(state.isHost));

    document.getElementById('lrid').textContent = state.roomId;
    show('lobby');
    window._startListening?.();
    dbg('ルーム作成: ' + state.roomId);
  } catch (e) {
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
  const nm  = document.getElementById('ni').value.trim();
  const rid = document.getElementById('ri').value.trim().toUpperCase();
  if (!nm)              { setHomeMsg('名前を入力してください'); return; }
  if (rid.length !== 4) { setHomeMsg('4文字のルームIDを入力してください'); return; }
  setHomeMsg('');
  setLoading('join-btn', true, '参加中');
  try {
    const room = await fbGet('rooms/' + rid);
    if (!room)                  { setHomeMsg('ルームが見つかりません'); return; }
    if (room.state !== 'lobby') { setHomeMsg('ゲームはすでに始まっています'); return; }
    const players = room.players || [];
    if (players.length >= 8)              { setHomeMsg('このルームは満員です（最大8人）'); return; }
    if (players.find(p => p.name === nm)) { setHomeMsg('この名前はすでに使われています'); return; }
    state.myName = nm;
    state.myId   = uid();
    state.isHost = false;
    state.roomId = rid;
    players.push({ id: state.myId, name: state.myName, bi: players.length, ready: false });
    await fbUpdate('rooms/' + rid, { players });

    // LocalStorageにセッション情報を保存
    localStorage.setItem('savedRoomId', state.roomId);
    localStorage.setItem('savedMyId', state.myId);
    localStorage.setItem('savedMyName', state.myName);
    localStorage.setItem('savedIsHost', String(state.isHost));

    document.getElementById('lrid').textContent = state.roomId;
    show('lobby');
    window._startListening?.();
    dbg('参加完了: ' + rid);
  } catch (e) {
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
    const players = room.players || [];
    const me      = players.find(p => p.id === state.myId);
    if (me) {
      me.ready = !me.ready;
      await fbUpdate('rooms/' + state.roomId, { players });
    }
  } catch (e) { dbg('toggleReady error: ' + e.message, true); }
};

// ----------------------------------------
// lobbyへ戻る
// ----------------------------------------
window.backToLobby = async function () {
  try {
    const room    = await fbGet('rooms/' + state.roomId);
    if (!room) return;
    const players = (room.players || []).map(p => ({ ...p, ready: p.id === room.host }));
    await fbUpdate('rooms/' + state.roomId, {
      state: 'lobby', game: null, log: [], players, reactions: {}, trumpPassCount: 0,
    });
    show('lobby');
    window._startListening?.();
  } catch (e) { dbg('backToLobby error: ' + e.message, true); }
};

// ----------------------------------------
// 退出（無人なら部屋削除）
// ----------------------------------------
window.leaveGame = async function () {
  const rid  = state.roomId;
  const myId = state.myId;
  window._stopListening?.();
  if (rid && myId) {
    try {
      const room = await fbGet('rooms/' + rid);
      if (room && room.players) {
        const remainingPlayers = room.players.filter(p => p.id !== myId);
        if (remainingPlayers.length === 0) {
          await fbSet('rooms/' + rid, null);
          dbg('無人になったためルームを削除しました: ' + rid);
        } else {
          const updates = { players: remainingPlayers };
          if (room.host === myId) {
            updates.host = remainingPlayers[0].id;
            const logs = [...(room.log || []), `${remainingPlayers[0].name} が新しいホストになりました`];
            updates.log = logs.slice(-8);
          }
          await fbUpdate('rooms/' + rid, updates);
          dbg('ルームから退出しました: ' + rid);
        }
      }
    } catch (e) { dbg('退出処理でエラーが発生しました: ' + e.message, true); }
  }
  // LocalStorageからセッション情報をクリア
  localStorage.removeItem('savedRoomId');
  localStorage.removeItem('savedMyId');
  localStorage.removeItem('savedMyName');
  localStorage.removeItem('savedIsHost');
  
  state.roomId = '';
  state.myId   = '';
  state.myName = '';
  state.isHost = false;
  show('home');
};

// ----------------------------------------
// inputオートフォーマット
// ----------------------------------------
document.getElementById('ri').addEventListener('input', function () {
  this.value = this.value.toUpperCase();
});
