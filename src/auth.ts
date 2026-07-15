// ========================================
// 認証・ルーム管理
// Google認証とルームのCRUD操作を担う。
// ゲームロジックには依存しない。
// ========================================
import { state, uid, newRoomId } from './state.js';
import { fbGet, fbSet, fbUpdate, testConnection } from './db.js';
import { auth, googleProvider } from './firebase-config.js';
import { signInWithPopup, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { show, setHomeMsg, setLobbyMsg, setStatus, dbg, setLoading } from './ui/ui-render.js';

// window オブジェクトに生やす関数の型宣言
// （index.html の onclick="..." から呼ばれるため window に公開する必要がある。
//   _startListening / _stopListening は app.js 側が登録するので optional にする）
declare global {
  interface Window {
    createRoom: () => Promise<void>;
    joinRoom: () => Promise<void>;
    toggleReady: () => Promise<void>;
    backToLobby: () => Promise<void>;
    leaveGame: () => Promise<void>;
    _startListening?: () => void;
    _stopListening?: () => void;
  }
}

// ----------------------------------------
// Google ログイン
// ----------------------------------------
const loginButton = document.getElementById('login-btn');
if (loginButton) {
  loginButton.addEventListener('click', async () => {
    try {
      setStatus('Google ログイン画面を起動中...');
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      setHomeMsg('ログイン失敗: ' + e.message);
      setStatus('ログインエラー', 'err');
      dbg('Googleログイン失敗: ' + e.message, true);
    }
  });
}

onAuthStateChanged(auth, async (user: any) => {
  const loginArea    = document.getElementById('login-area');
  const gameMenuArea = document.getElementById('game-menu-area');
  const niInput      = document.getElementById('ni') as HTMLInputElement | null;
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
            setStatus(`ログイン中: ${user.displayName} ✓`, 'ok');
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
  }
});

// ----------------------------------------
// ルーム作成
// ----------------------------------------
window.createRoom = async function () {
  const nm = (document.getElementById('ni') as HTMLInputElement).value.trim();
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
  try {
    const room = await fbGet('rooms/' + rid);
    if (!room)                  { setHomeMsg('ルームが見つかりません'); return; }
    if (room.state !== 'lobby') { setHomeMsg('ゲームはすでに始まっています'); return; }
    const players: any[] = room.players || [];
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
// lobbyへ戻る
// ----------------------------------------
window.backToLobby = async function () {
  try {
    const room = await fbGet('rooms/' + state.roomId);
    if (!room) return;

    // ★修正：まだ誰も部屋をリセットしていない場合のみ、Firebaseを初期化する
    if (room.state !== 'lobby') {
      const players = (room.players || []).map((p: any) => ({ ...p, ready: p.id === room.host }));
      await fbUpdate('rooms/' + state.roomId, {
        state: 'lobby', game: null, log: [], players, reactions: {}, trumpPassCount: 0,
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
// ----------------------------------------
function clearSessionAndGoHome(): void {
  localStorage.removeItem('savedRoomId');
  localStorage.removeItem('savedMyId');
  localStorage.removeItem('savedMyName');
  localStorage.removeItem('savedIsHost');
  state.roomId = '';
  state.myId = '';
  state.myName = '';
  state.isHost = false;
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

        // 全プレイヤーが退室済みになったら、ボットだけの無人試合を続けずに削除
        const allLeft = room.players.every((p: any) => leftPlayers[p.id]);
        if (allLeft) {
          await fbSet('rooms/' + rid, null);
          dbg('全員退室したためルームを削除しました: ' + rid);
        } else {
          const updates: any = { leftPlayers, autoPlayers };
          const myName = room.players.find((p: any) => p.id === myId)?.name ?? 'プレイヤー';
          // ホスト自身が退室する場合、退室していないプレイヤーへホストを移譲する
          if (room.host === myId) {
            const nextHost = room.players.find((p: any) => !leftPlayers[p.id]);
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
        show('home');
        return;
      }

      // ---- 従来どおりの退出（ロビー中・ゲーム終了後）----
      const remainingPlayers = room.players.filter((p: any) => p.id !== myId);
      if (remainingPlayers.length === 0) {
        await fbSet('rooms/' + rid, null);
        dbg('無人になったためルームを削除しました: ' + rid);
      } else {
        const updates: { players: any[]; host?: string; log?: string[] } = { players: remainingPlayers };
        if (room.host === myId) {
          updates.host = remainingPlayers[0].id;
          const logs = [...(room.log || []), `${remainingPlayers[0].name} が新しいホストになりました`];
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
