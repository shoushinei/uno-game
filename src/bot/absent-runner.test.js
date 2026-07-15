// ========================================
// absent-runner.ts 単体テスト（代行対象の判定）
// ========================================
import { describe, it, expect, vi } from 'vitest';

// absent-runner は execute → game-actions → db → firebase-config(CDN import)
// という連鎖を引き込むため、node 環境では db をモックして CDN 読み込みを防ぐ
vi.mock('../db.js', () => ({
  fbGet: vi.fn(),
  fbSet: vi.fn(),
  fbUpdate: vi.fn(),
}));

import { absentActorToRun } from './absent-runner.js';

const base = (over = {}) => ({
  roomHost: 'host1',
  roomState: 'playing',
  myId: 'host1',
  order: ['host1', 'p2', 'p3'],
  ci: 1, // p2の手番
  leftPlayers: { p2: true },
  ...over,
});

describe('absentActorToRun', () => {
  it('自分がホストで、手番が退室者(p2)なら p2 を返す', () => {
    expect(absentActorToRun(base())).toBe('p2');
  });

  it('自分がホストでなければ null（代行しない）', () => {
    expect(absentActorToRun(base({ myId: 'p3' }))).toBeNull();
  });

  it('ゲーム進行中でなければ null', () => {
    expect(absentActorToRun(base({ roomState: 'lobby' }))).toBeNull();
    expect(absentActorToRun(base({ roomState: 'ended' }))).toBeNull();
  });

  it('手番プレイヤーが退室者でなければ null（人間の手番には介入しない）', () => {
    // ci=0 は host1（人間）の手番
    expect(absentActorToRun(base({ ci: 0 }))).toBeNull();
    // p3 の手番だが p3 は退室していない
    expect(absentActorToRun(base({ ci: 2 }))).toBeNull();
  });

  it('order が空・未定義なら null', () => {
    expect(absentActorToRun(base({ order: [] }))).toBeNull();
    expect(absentActorToRun(base({ order: undefined }))).toBeNull();
  });

  it('roomHost が null なら null', () => {
    expect(absentActorToRun(base({ roomHost: null }))).toBeNull();
  });

  it('複数の退室者がいても、今の手番の退室者だけを返す', () => {
    const params = base({ leftPlayers: { p2: true, p3: true }, ci: 2 });
    expect(absentActorToRun(params)).toBe('p3');
  });
});
