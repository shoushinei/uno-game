// ========================================
// Cloud Functions 本体（Phase 2: 戦績のサーバー書き込み）
//
// rooms/{roomId}/state が 'ended' になった瞬間に発火し、そのゲームの
// 順位を読み取って Firestore に戦績を書き込む。
//
// 設計上の要点（合意済み）:
// - サーバー（Admin SDK）だけが戦績を書く。クライアントは Firestore ルールで
//   書き込み不可＝コンソールからの直接改ざんは不可能
// - 全プレイヤー分を一括で書くため、ゲーム終了前に切断した人の分も記録される
// - ボット（players[].isBot）とゲスト（匿名認証）は記録しない
// - 冪等性: room.gameId ごとに processedGames/{gameId} マーカーを
//   トランザクション内で create し、二重発火・再実行でも二重記録しない
// - 暴走課金対策: maxInstances を制限（Blaze プランの安全装置）
// ========================================
import { onValueWritten } from 'firebase-functions/v2/database';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as logger from 'firebase-functions/logger';
import * as admin from 'firebase-admin';
import { applyGameResult } from './stats-logic';
import {
  analyzePlayerActions,
  buildCardById,
  evaluateAchievements,
} from './achievements-logic';

admin.initializeApp();

// 友達規模のゲームに数百インスタンスは不要。バグの無限ループ等で
// スケールアウトして課金が走る事故をここで構造的に防ぐ
setGlobalOptions({ maxInstances: 3 });

export const onGameEnded = onValueWritten(
  // Realtime Database（default インスタンス）は us-central1 にあるため、
  // トリガー関数のリージョンもそれに合わせる（Firestore が東京でも問題ない）
  { ref: '/rooms/{roomId}/state', region: 'us-central1' },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    // 「ended になった瞬間」だけ処理（ended のままの再書き込み等は無視）
    if (after !== 'ended' || before === 'ended') return;

    const roomId = event.params.roomId;
    const roomSnap = await admin.database().ref('rooms/' + roomId).get();
    const room = roomSnap.val();
    if (!room) return;

    const gameId: unknown = room.gameId;
    const rankings: unknown = room.game?.rankings;
    if (typeof gameId !== 'string' || !gameId) {
      logger.info(`room ${roomId}: gameId が無いため戦績記録をスキップ（旧バージョンのゲーム）`);
      return;
    }
    if (!Array.isArray(rankings) || rankings.length === 0) {
      logger.warn(`room ${roomId}: rankings が無いため戦績記録をスキップ`);
      return;
    }

    // ボットを除いた「人間の順位」候補
    const players: any[] = Array.isArray(room.players) ? room.players : [];
    const botIds = new Set(players.filter((p) => p?.isBot).map((p) => p.id));
    const humanRanks = rankings
      .map((r: any, i: number) => ({ uid: String(r?.id ?? ''), name: String(r?.name ?? '?'), rank: i + 1 }))
      .filter((r) => r.uid && !botIds.has(r.uid));
    if (humanRanks.length === 0) return;

    // ゲスト（匿名認証）を除外する。匿名ユーザーは providerData が空。
    // Auth に存在しない ID（異常系）も記録対象から外れる
    const lookup = await admin.auth().getUsers(humanRanks.map((r) => ({ uid: r.uid })));
    const accountIds = new Set(
      lookup.users.filter((u) => u.providerData.length > 0).map((u) => u.uid)
    );
    const accountRanks = humanRanks.filter((r) => accountIds.has(r.uid));
    if (accountRanks.length === 0) {
      logger.info(`room ${roomId} (${gameId}): アカウント保持者がいないため記録なし`);
      return;
    }

    // 対局履歴に載せる参加者一覧（アカウント保持者のみ。Phase 4 の
    // 「直近一緒に遊んだ人にフレンド申請」機能のデータ源になる）
    const participants = accountRanks.map((r) => ({ uid: r.uid, name: r.name }));
    const playerCount = rankings.length;
    const finishedAt = Date.now();
    // ★戦績刷新★ ボット入りの卓か（ボットなし=全員人間の卓と集計を分ける）
    const hasBots = players.some((p) => p?.isBot);

    // ★Phase 3★ 実績判定用: actionLog と初期トランプ札の対応表
    const actionLog: any[] = Array.isArray(room.actionLog) ? room.actionLog : [];
    const cardById = buildCardById(room.replayInitialState?.trumpHands);

    const fs = admin.firestore();
    const processed = await fs.runTransaction(async (tx) => {
      // 冪等ガード: 既に処理済みの gameId なら何もしない
      const marker = fs.doc('processedGames/' + gameId);
      if ((await tx.get(marker)).exists) {
        return false;
      }
      const userRefs = accountRanks.map((r) => fs.doc('users/' + r.uid));
      const userSnaps = await Promise.all(userRefs.map((ref) => tx.get(ref)));

      tx.create(marker, { roomId, finishedAt });
      accountRanks.forEach((r, i) => {
        const data = userSnaps[i].exists ? userSnaps[i].data() : null;
        const prevStats = data?.stats ?? null;
        const stats = applyGameResult(prevStats, { rank: r.rank, playerCount, at: finishedAt, hasBots });

        // ---- 実績（Phase 3）----
        const acts = analyzePlayerActions(actionLog, r.uid, cardById, true /* rankings入り=上がり */);
        const prevSayUno = typeof data?.counters?.sayUno === 'number' ? data.counters.sayUno : 0;
        const sayUnoCumulative = prevSayUno + acts.sayUnoCount;
        const unlockedNow = evaluateAchievements({
          statsBefore: prevStats,
          statsAfter: stats,
          rank: r.rank,
          sayUnoCumulative,
          actions: acts,
        });
        // 既に解除済みの実績は上書きしない（解除日時を保つ）。新規分だけ追記
        const existing = (data?.achievements ?? {}) as Record<string, number>;
        const achievements: Record<string, number> = {};
        for (const id of unlockedNow) {
          if (existing[id] === undefined) achievements[id] = finishedAt;
        }

        const userUpdate: any = {
          stats,
          counters: { sayUno: sayUnoCumulative },
        };
        if (Object.keys(achievements).length > 0) userUpdate.achievements = achievements;

        // users/{uid} が無い場合（プロフィール作成失敗など）でも merge で作る
        tx.set(userRefs[i], userUpdate, { merge: true });
        tx.set(fs.doc(`users/${r.uid}/games/${gameId}`), {
          roomId,
          rank: r.rank,
          playerCount,
          finishedAt,
          participants,
          hasBots,
        });
      });
      return true;
    });

    if (processed) {
      logger.info(`${gameId}: 戦績・実績を記録しました（${accountRanks.length}人分 / 卓${playerCount}人）`);
    } else {
      logger.info(`${gameId}: 処理済みのためスキップ`);
    }
  }
);
