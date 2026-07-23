// ========================================
// yacht-actions.ts 単体テスト（close時の敗者ペナルティ・権限）
// ========================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { actionYachtClose } from './yacht-actions.js';
import { fbGet, fbUpdate } from '../db.js';

vi.mock('../db.js', () => ({ fbGet: vi.fn(), fbUpdate: vi.fn(), fbSet: vi.fn() }));
vi.mock('../state.js', () => ({ state: { roomId: 'ROOM1', myId: 'atk', myName: 'A' } }));

/** 決着済みduel（守備側 def の勝ち＝攻撃側 atk が敗者） */
const doneDuel = (over = {}) => ({
  attackerId: 'atk', defenderId: 'def',
  turn: 'defender', stage: 'done',
  attacker: { dice: [1,1,2,2,3], rollsLeft: 0, done: true, best: { category: '3', score: 9 } },
  defender: { dice: [6,6,6,6,6], rollsLeft: 2, done: true, best: { category: 'yacht', score: 50 } },
  result: 'defender', winnerId: 'def', startedAt: 1,
  ...over,
});

const mkRoom = (over = {}) => ({
  state: 'playing', host: 'host1', mode: 'yacht',
  players: [
    { id: 'atk', name: 'アタッカー' },
    { id: 'def', name: 'ディフェンダー' },
  ],
  log: [],
  duel: doneDuel(),
  game: {
    unoHands: { atk: [{ c: 'r', t: 'n', v: '3' }], def: [{ c: 'b', t: 'n', v: '5' }] },
    unoDrawPile: [
      { c:'r',t:'n',v:'1' }, { c:'g',t:'n',v:'2' }, { c:'b',t:'n',v:'4' },
      { c:'y',t:'n',v:'7' }, { c:'r',t:'n',v:'9' },
    ],
    unoDiscardPile: [{ c:'g',t:'n',v:'8' }],
    unoSaid: { atk: true, def: false },
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  fbUpdate.mockResolvedValue({});
});

describe('actionYachtClose — 敗者ペナルティ（Step 3）', () => {
  it('敗者（攻撃側）がUNOを4枚引き、宣言状態がリセットされ、duelがnullになる', async () => {
    fbGet.mockResolvedValue(mkRoom());
    const r = await actionYachtClose();
    expect(r.ok).toBe(true);
    const updates = fbUpdate.mock.calls[0][1];
    expect(updates.duel).toBeNull();
    expect(updates.game.unoHands.atk).toHaveLength(1 + 4);
    expect(updates.game.unoSaid.atk).toBe(false);
    expect(updates.log.join('|')).toContain('敗北ペナルティでUNOを4枚引いた');
    expect(updates.log.join('|')).not.toContain('復帰');
  });

  it('UNO側を上がっていた敗者は復帰ログが出る', async () => {
    const room = mkRoom();
    room.game.unoHands.atk = []; // UNO側上がり済み
    fbGet.mockResolvedValue(room);
    await actionYachtClose();
    const updates = fbUpdate.mock.calls[0][1];
    expect(updates.game.unoHands.atk).toHaveLength(4);
    expect(updates.log.join('|')).toContain('ゲームに復帰');
  });

  it('山札が足りなければ捨て札から補充して必ず4枚引ける', async () => {
    const room = mkRoom();
    room.game.unoDrawPile = [{ c:'r',t:'n',v:'1' }]; // 1枚しかない
    room.game.unoDiscardPile = [
      { c:'g',t:'n',v:'2' }, { c:'b',t:'n',v:'4' }, { c:'y',t:'n',v:'7' }, { c:'g',t:'n',v:'8' },
    ];
    fbGet.mockResolvedValue(room);
    await actionYachtClose();
    const updates = fbUpdate.mock.calls[0][1];
    expect(updates.game.unoHands.atk).toHaveLength(1 + 4);
  });

  it('引き分けは誰も引かない（gameを触らない）', async () => {
    fbGet.mockResolvedValue(mkRoom({ duel: doneDuel({ result: 'draw', winnerId: null }) }));
    await actionYachtClose();
    const updates = fbUpdate.mock.calls[0][1];
    expect(updates.duel).toBeNull();
    expect(updates.game).toBeUndefined();
  });

  it('当事者でもホスト代行条件でもなければ拒否', async () => {
    // myId='atk' は当事者なのでOK → 当事者でないケースを作る
    const room = mkRoom({ duel: doneDuel({ attackerId: 'x1', defenderId: 'x2', winnerId: 'x2', result: 'defender' }) });
    fbGet.mockResolvedValue(room);
    const r = await actionYachtClose();
    expect(r.error).toBeTruthy();
    expect(fbUpdate).not.toHaveBeenCalled();
  });

  it('両当事者がボット/退室者ならホストが代行で閉じられる（ペナルティも適用）', async () => {
    const room = mkRoom({
      host: 'atk', // テスト都合: myId('atk')をホストにする
      players: [
        { id: 'x1', name: 'ボット', isBot: true },
        { id: 'x2', name: '退室者' },
        { id: 'atk', name: 'ホスト' },
      ],
      leftPlayers: { x2: true },
      duel: doneDuel({ attackerId: 'x1', defenderId: 'x2', winnerId: 'x2', result: 'defender' }),
    });
    room.game.unoHands = { x1: [{ c:'r',t:'n',v:'3' }], x2: [] };
    fbGet.mockResolvedValue(room);
    const r = await actionYachtClose();
    expect(r.ok).toBe(true);
    const updates = fbUpdate.mock.calls[0][1];
    expect(updates.game.unoHands.x1).toHaveLength(1 + 4); // 敗者x1(ボット)が4枚
  });

  it('決着前は閉じられない', async () => {
    fbGet.mockResolvedValue(mkRoom({ duel: doneDuel({ stage: 'rolling' }) }));
    const r = await actionYachtClose();
    expect(r.error).toBeTruthy();
  });
});
