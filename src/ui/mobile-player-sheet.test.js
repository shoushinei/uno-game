// ========================================
// mobile-player-sheet.ts / mobile-layout.ts（M3分）単体テスト
// ========================================
import { describe, it, expect, beforeEach } from 'vitest';
import { buildPlayerSheetHtml } from './mobile-player-sheet.js';
import { takeIncomingHit, resetHitToast } from './mobile-layout.js';

const base = {
  id: 'p1', name: 'たろう', icon: '🐶', title: '初勝利',
  trumpCount: 9, unoCount: 6, isBot: false, isLeft: false,
  finishedRank: null, canDuel: false, duelReason: null,
  blocked: false, onCooldown: false,
};

describe('buildPlayerSheetHtml', () => {
  it('名前・アイコン・称号と枚数を出す', () => {
    const h = buildPlayerSheetHtml(base);
    expect(h).toContain('たろう');
    expect(h).toContain('🐶');
    expect(h).toContain('初勝利');
    expect(h).toContain('🃏 9枚');
    expect(h).toContain('🎴 6枚');
  });

  it('上がり済みなら枚数ではなく順位を出す', () => {
    const h = buildPlayerSheetHtml({ ...base, finishedRank: 2 });
    expect(h).toContain('2位で上がり');
    expect(h).not.toContain('🃏 9枚');
  });

  it('挑めるときは「⚔ ヨットで挑む」が押せる', () => {
    const h = buildPlayerSheetHtml({ ...base, canDuel: true });
    expect(h).toContain('ヨットで挑む');
    expect(h).not.toContain('disabled');
  });

  it('ヨットモードで挑めないときは理由を添えて無効表示する', () => {
    const h = buildPlayerSheetHtml({ ...base, canDuel: false, duelReason: 'スキルは1ゲームに1回だけです' });
    expect(h).toContain('ヨットで挑む');
    expect(h).toContain('スキルは1ゲームに1回だけです');
    expect(h).toContain('disabled');
  });

  it('ヨットモードでなければ「挑む」自体を出さない', () => {
    const h = buildPlayerSheetHtml({ ...base, canDuel: false, duelReason: null });
    expect(h).not.toContain('ヨットで挑む');
  });

  it('戦績・対人リアクション・ブロックの入口を必ず持つ', () => {
    const h = buildPlayerSheetHtml(base);
    expect(h).toContain('data-ps="stats"');
    expect(h).toContain('data-ps="react"');
    expect(h).toContain('data-ps="block"');
  });

  it('クールダウン中は絵文字ボタンを無効化する', () => {
    const h = buildPlayerSheetHtml({ ...base, onCooldown: true });
    expect(h).toMatch(/data-ps="react"[^>]*disabled/);
  });

  it('ブロック中は解除の文言になる', () => {
    expect(buildPlayerSheetHtml({ ...base, blocked: true })).toContain('解除');
    expect(buildPlayerSheetHtml(base)).toContain('このプレイヤーをブロック');
  });

  it('ボット・退室中を見分けられる', () => {
    expect(buildPlayerSheetHtml({ ...base, isBot: true })).toContain('ボット');
    expect(buildPlayerSheetHtml({ ...base, isLeft: true })).toContain('退室中');
  });

  it('名前のHTMLをエスケープする', () => {
    const h = buildPlayerSheetHtml({ ...base, name: '<img src=x onerror=alert(1)>' });
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });
});

describe('takeIncomingHit', () => {
  const players = [{ id: 'me', name: 'じぶん' }, { id: 'p1', name: 'たろう' }];
  const never = () => false;
  beforeEach(() => resetHitToast());

  it('初回同期では何も返さない（再接続で過去分が一斉に出るのを防ぐ）', () => {
    const r = { p1: { emoji: '🍅', ts: 1000, targetId: 'me' } };
    expect(takeIncomingHit(r, 'me', players, 1100, never)).toBeNull();
  });

  it('2回目以降に新しく自分宛てが来たら送り主の名前とともに返す', () => {
    takeIncomingHit({}, 'me', players, 1000, never); // 既読化
    const r = { p1: { emoji: '🍅', ts: 2000, targetId: 'me' } };
    expect(takeIncomingHit(r, 'me', players, 2100, never)).toEqual({ emoji: '🍅', fromName: 'たろう' });
  });

  it('同じリアクションを二度返さない（トーストが繰り返さない）', () => {
    takeIncomingHit({}, 'me', players, 1000, never);
    const r = { p1: { emoji: '🍅', ts: 2000, targetId: 'me' } };
    expect(takeIncomingHit(r, 'me', players, 2100, never)).not.toBeNull();
    expect(takeIncomingHit(r, 'me', players, 2200, never)).toBeNull();
  });

  it('自分宛てでない対人リアクションは返さない', () => {
    takeIncomingHit({}, 'me', players, 1000, never);
    const r = { p1: { emoji: '🍅', ts: 2000, targetId: 'p2' } };
    expect(takeIncomingHit(r, 'me', players, 2100, never)).toBeNull();
  });

  it('全体リアクション（宛先なし）は返さない', () => {
    takeIncomingHit({}, 'me', players, 1000, never);
    const r = { p1: { emoji: '🎉', ts: 2000 } };
    expect(takeIncomingHit(r, 'me', players, 2100, never)).toBeNull();
  });

  it('ブロックしている相手からは返さない', () => {
    takeIncomingHit({}, 'me', players, 1000, never);
    const r = { p1: { emoji: '🍅', ts: 2000, targetId: 'me' } };
    expect(takeIncomingHit(r, 'me', players, 2100, id => id === 'p1')).toBeNull();
  });

  it('8秒以上前の古いものは返さない（再接続時の一斉再生を防ぐ）', () => {
    takeIncomingHit({}, 'me', players, 1000, never);
    const r = { p1: { emoji: '🍅', ts: 2000, targetId: 'me' } };
    expect(takeIncomingHit(r, 'me', players, 2000 + 9000, never)).toBeNull();
  });
});
