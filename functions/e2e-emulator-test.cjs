// ========================================
// Cloud Functions のエミュレータE2E検証スクリプト（Phase 2）
//
// 使い方:
//   1. リポジトリルートで: npx firebase-tools emulators:start --only database,firestore,functions,auth
//   2. 別ターミナルで:      cd functions && node e2e-emulator-test.cjs
//
// 検証内容:
//   - アカウント2人+ゲスト1人+ボット1体の4人卓を RTDB エミュレータに作り
//     state を ended にする → onGameEnded が発火
//   - アカウント2人だけに stats と games 履歴が書かれること
//   - ゲスト・ボットには書かれないこと
//   - 同じ gameId の再発火が二重記録されないこと（冪等マーカー）
// ========================================
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';

const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'uno-game-b6d37',
  databaseURL: 'http://127.0.0.1:9000?ns=uno-game-b6d37-default-rtdb',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 条件が真になるまでポーリング（関数のコールドスタートが遅くても待てるように） */
async function waitFor(label, fn, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - start > timeoutMs) {
      console.log(`⏱ タイムアウト: ${label}`);
      return false;
    }
    await sleep(500);
  }
}

async function main() {
  const db = admin.database();
  const fs = admin.firestore();
  const roomId = 'E2E1';
  const gameId = `${roomId}-${Date.now()}`;

  // ---- Auth エミュレータにユーザーを用意 ----
  // アカウント2人（email あり = providerData あり）
  // ゲスト1人（provider なし = 匿名相当）
  const mk = async (opts) => {
    try { await admin.auth().deleteUser(opts.uid); } catch { /* 初回は居ない */ }
    await admin.auth().createUser(opts);
  };
  await mk({ uid: 'acc-alice', email: 'alice@example.com', password: 'password1' });
  await mk({ uid: 'acc-bob', email: 'bob@example.com', password: 'password1' });
  await mk({ uid: 'guest-carol' }); // email なし → providerData 空 = ゲスト扱い

  // ---- 前回のデータを掃除 ----
  await fs.recursiveDelete(fs.doc('users/acc-alice')).catch(() => {});
  await fs.recursiveDelete(fs.doc('users/acc-bob')).catch(() => {});
  await fs.recursiveDelete(fs.doc('users/guest-carol')).catch(() => {});

  // ---- ルームを作成（playing）→ ended ----
  const room = {
    state: 'playing',
    host: 'acc-alice',
    gameId,
    players: [
      { id: 'acc-alice', name: 'アリス' },
      { id: 'acc-bob', name: 'ボブ' },
      { id: 'guest-carol', name: 'キャロル' },
      { id: 'bot-1', name: '🤖ポンタ', isBot: true },
    ],
    game: {
      rankings: [
        { id: 'acc-bob', name: 'ボブ' },      // 1位
        { id: 'guest-carol', name: 'キャロル' }, // 2位（ゲスト）
        { id: 'bot-1', name: '🤖ポンタ' },     // 3位（ボット）
        { id: 'acc-alice', name: 'アリス' },   // 4位
      ],
    },
    // 実績判定用（Phase 3）: ボブが 8切り＋同一ターン上がり＋UNO宣言1回
    replayInitialState: {
      trumpHands: {
        'acc-bob': [{ s: '♠', v: '8', id: '♠8' }],
        'acc-alice': [{ s: '♥', v: 'K', id: '♥K' }],
      },
    },
    actionLog: [
      { type: 'trumpPlay', playerId: 'acc-bob', args: { cardIds: ['♠8'] }, ts: 1 }, // 8切り＆トランプ出し切り
      { type: 'sayUno', playerId: 'acc-bob', args: {}, ts: 2 },
      { type: 'unoPlay', playerId: 'acc-bob', args: {}, ts: 3 },                     // 同一ターンでUNOも出して上がり
    ],
  };
  await db.ref('rooms/' + roomId).set(room);
  await db.ref(`rooms/${roomId}/state`).set('ended');
  console.log('state=ended に設定。関数の発火を待機（コールドスタート込みで最大30秒）...');
  await waitFor('冪等マーカーの出現', async () =>
    (await fs.doc('processedGames/' + gameId).get()).exists
  );

  // ---- 検証 ----
  const results = { pass: 0, fail: 0 };
  const check = (label, cond, detail = '') => {
    console.log(`${cond ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
    results[cond ? 'pass' : 'fail']++;
  };

  const alice = (await fs.doc('users/acc-alice').get()).data();
  const bob = (await fs.doc('users/acc-bob').get()).data();
  const carol = (await fs.doc('users/guest-carol').get()).data();

  check('ボブ(1位)の stats: 1勝・連勝1',
    bob?.stats?.games === 1 && bob?.stats?.wins === 1 && bob?.stats?.winStreak === 1,
    JSON.stringify(bob?.stats));
  check('アリス(4位)の stats: 0勝・連敗1',
    alice?.stats?.games === 1 && alice?.stats?.wins === 0 && alice?.stats?.loseStreak === 1,
    JSON.stringify(alice?.stats));
  check('ゲストには何も書かれない', carol === undefined, JSON.stringify(carol));

  const bobGame = (await fs.doc(`users/acc-bob/games/${gameId}`).get()).data();
  check('ボブの対局履歴: rank=1・卓4人', bobGame?.rank === 1 && bobGame?.playerCount === 4,
    JSON.stringify(bobGame));
  check('対局履歴の参加者はアカウント2人のみ（ゲスト・ボット除外）',
    Array.isArray(bobGame?.participants) && bobGame.participants.length === 2 &&
    bobGame.participants.every(p => ['acc-alice', 'acc-bob'].includes(p.uid)),
    JSON.stringify(bobGame?.participants));

  const marker = await fs.doc('processedGames/' + gameId).get();
  check('冪等マーカーが作られている', marker.exists);

  // ---- 実績（Phase 3）----
  const bobAchv = bob?.achievements ?? {};
  check('ボブに first-game / first-win が付与される',
    bobAchv['first-game'] !== undefined && bobAchv['first-win'] !== undefined,
    JSON.stringify(Object.keys(bobAchv)));
  check('ボブに eight-cut（8切り）が付与される', bobAchv['eight-cut'] !== undefined);
  check('ボブに double-finish（同一ターン上がり）が付与される', bobAchv['double-finish'] !== undefined);
  check('ボブの累計UNO宣言 counters.sayUno=1', bob?.counters?.sayUno === 1, JSON.stringify(bob?.counters));
  check('アリス(4位・8切りなし)に eight-cut は付かない',
    (alice?.achievements ?? {})['eight-cut'] === undefined,
    JSON.stringify(Object.keys(alice?.achievements ?? {})));

  // ---- 二重発火テスト: lobby に戻して再度 ended ----
  await db.ref(`rooms/${roomId}/state`).set('lobby');
  await db.ref(`rooms/${roomId}/state`).set('ended');
  // 再発火の処理が終わるのを待つ確実なシグナルが無いので、少し長めに待って確認
  await sleep(6000);
  const bob2 = (await fs.doc('users/acc-bob').get()).data();
  check('同じ gameId の再発火では二重記録されない', bob2?.stats?.games === 1,
    JSON.stringify(bob2?.stats));

  console.log(`\n結果: ${results.pass} passed / ${results.fail} failed`);
  process.exit(results.fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
