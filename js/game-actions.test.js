import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actionTrumpPlay } from './game-actions.js';
import { fbGet, fbUpdate } from './db.js';
import { state } from './state.js';

// 1. 実際のFirebase通信とログイン状態をテスト用に偽装（モック化）
vi.mock('./db.js', () => ({
  fbGet: vi.fn(),
  fbUpdate: vi.fn(),
  fbSet: vi.fn(),
}));

vi.mock('./state.js', () => ({
  state: {
    roomId: 'ROOM123',
    myId: 'p2', // ★修正：今回は2人目のあがりを検証するため、手番をBob（p2）にします
    myName: 'Bob',
  },
}));

describe('game-actions.js — actionTrumpPlay のゲーム終了・通信テスト', () => {
  beforeEach(() => {
    vi.clearAllMocks(); // テストごとに通信ログをリセット
  });

  it('★重要★ 最後のプレイヤーがトランプをプレイしてゲーム終了条件を満たしたとき、Firebaseに state: "ended" を送信すること', async () => {
    
    // 【前提状況の設定を修正】
    // 3人プレイ。すでに1位（p1: Alice）はあがり済み。
    // 現在は残った2人（p2: Bob と p3: Carol）でゲームが続いています。
    // ターンは Bob（ci: 0）。BobはすでにUNOを0枚にしており、トランプも残り1枚（♠K）の状況です。
    const mockRoom = {
      players: [
        { id: 'p1', name: 'Alice' },
        { id: 'p2', name: 'Bob' },
        { id: 'p3', name: 'Carol' },
      ],
      log: [],
      trumpPassCount: 0,
      state: 'playing',
      game: {
        order: ['p2', 'p3'], // ★修正：Aliceは抜けているので残り2人
        ci: 0,               // p2（Bob）のターン
        phase: 'trump',
        dir: 1,
        rankings: [{ id: 'p1', name: 'Alice' }], // ★修正：1位はすでにAliceで確定済み
        trumpField: [], // 場は空なので何でも出せる
        trumpHands: {
          p2: [{ s: '♠', v: 'K', id: '♠K' }], // ★Bobの最後の1枚
          p3: [{ s: '♦', v: '4', id: '♦4' }],
        },
        unoHands: {
          p2: [], // ★BobはすでにUNOを出し切り済み！
          p3: [{ t: 'b', v: '7' }],
        },
      },
    };

    // データベース（Firebase）が上記のルームデータを返すように仕込みます
    fbGet.mockResolvedValue(mockRoom);
    fbUpdate.mockResolvedValue({ ok: true });

    // 【アクション実行】
    // Bobが最後の1枚「♠K」をプレイします
    const result = await actionTrumpPlay(['♠K']);

    // 【検証①】Bobが上がったことで残りがCarol（1人）になるため、今度は確実に isGameOver が true になります！
    expect(result.ok).toBe(true);
    expect(result.isGameOver).toBe(true);

    // 【検証②】Firebaseのデータ更新に【 state: 'ended' 】が確実に含まれているかを検証
    expect(fbUpdate).toHaveBeenCalledWith(
      'rooms/ROOM123',
      expect.objectContaining({
        state: 'ended', // ここで 'ended' が通信に乗ることを保証！
      })
    );

    // 【検証③】内部データ・ランキングの検証
    const updatedData = fbUpdate.mock.calls[0][1];
    expect(updatedData.game.rankings[1].id).toBe('p2'); // Bobが2位に記録されていること
    expect(updatedData.game.rankings[2].id).toBe('p3'); // 残ったCarolが自動的に3位（最下位）に補完されていること
    expect(updatedData.game.order).not.toContain('p2');  // Bobが手番から除外されていること
  });
});