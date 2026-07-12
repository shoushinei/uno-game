// ========================================
// last-actions.ts 単体テスト
// ========================================
import { describe, it, expect } from 'vitest';
import {
  lastActionsOf,
  parseTrumpCardId,
  summarizeTrumpEntry,
  summarizeUnoEntry,
} from './last-actions.js';

const e = (type, playerId, args = {}) => ({ type, playerId, args, ts: 1 });

describe('lastActionsOf', () => {
  it('トランプ系・UNO系それぞれの最新1件を拾う', () => {
    const log = [
      e('trumpPlay', 'p1', { cardIds: ['♠5'] }),
      e('unoDraw', 'p1', { count: 1 }),
      e('trumpPass', 'p1'),
      e('unoPlay', 'p1', { cardIdx: 0, chosenColor: null }),
    ];
    const r = lastActionsOf(log, 'p1');
    expect(r.trump.type).toBe('trumpPass');
    expect(r.uno.type).toBe('unoPlay');
  });

  it('他プレイヤーの操作は無視する', () => {
    const log = [
      e('trumpPlay', 'p1', { cardIds: ['♠5'] }),
      e('trumpPass', 'p2'),
    ];
    const r = lastActionsOf(log, 'p1');
    expect(r.trump.type).toBe('trumpPlay');
    expect(r.uno).toBeNull();
  });

  it('actionLog が無い（古いルーム）なら両方 null', () => {
    expect(lastActionsOf(undefined, 'p1')).toEqual({ trump: null, uno: null });
    expect(lastActionsOf(null, 'p1')).toEqual({ trump: null, uno: null });
  });

  it('sayUno / pickParentColor はUNO系として拾う', () => {
    const r1 = lastActionsOf([e('sayUno', 'p1')], 'p1');
    expect(r1.uno.type).toBe('sayUno');
    const r2 = lastActionsOf([e('pickParentColor', 'p1', { color: 'blue' })], 'p1');
    expect(r2.uno.type).toBe('pickParentColor');
  });
});

describe('parseTrumpCardId', () => {
  it('スーツ＋数値のIDを復元できる', () => {
    expect(parseTrumpCardId('♠5')).toEqual({ s: '♠', v: '5', id: '♠5' });
    expect(parseTrumpCardId('♥10')).toEqual({ s: '♥', v: '10', id: '♥10' });
  });

  it('JOKER を復元できる', () => {
    expect(parseTrumpCardId('JOKER')).toEqual({ s: '🃏', v: 'JOKER', id: 'JOKER' });
  });

  it('想定外の形式は null', () => {
    expect(parseTrumpCardId('x5')).toBeNull();
    expect(parseTrumpCardId('♠')).toBeNull();
  });
});

describe('summarizeTrumpEntry', () => {
  it('trumpPlay はカード＋「を出した」', () => {
    const r = summarizeTrumpEntry(e('trumpPlay', 'p1', { cardIds: ['♦8', '♣8'] }));
    expect(r.cards.length).toBe(2);
    expect(r.text).toContain('を出した');
    expect(r.text).toContain('8切り');
  });

  it('8を含まなければ注記なし', () => {
    const r = summarizeTrumpEntry(e('trumpPlay', 'p1', { cardIds: ['♠5'] }));
    expect(r.text).toBe('を出した');
  });

  it('ジョーカー単体は注記付き', () => {
    const r = summarizeTrumpEntry(e('trumpPlay', 'p1', { cardIds: ['JOKER'] }));
    expect(r.text).toContain('🃏単体');
  });

  it('パス・スキップ', () => {
    expect(summarizeTrumpEntry(e('trumpPass', 'p1')).text).toBe('パス');
    expect(summarizeTrumpEntry(e('trumpSkip', 'p1')).text).toBe('出し切りスキップ');
  });
});

describe('summarizeUnoEntry', () => {
  it('unoPlay（カード記録あり）はカード＋「を出した」', () => {
    const r = summarizeUnoEntry(e('unoPlay', 'p1', { cardIdx: 0, chosenColor: null, card: { c: 'red', t: 'num', v: '5' } }));
    expect(r.card).toEqual({ c: 'red', t: 'num', v: '5' });
    expect(r.text).toBe('を出した');
  });

  it('unoPlay（ワイルド）は色変更の注記付き', () => {
    const r = summarizeUnoEntry(e('unoPlay', 'p1', { cardIdx: 0, chosenColor: 'blue', card: { c: 'w', t: 'w', v: 'W' } }));
    expect(r.text).toContain('青に変更');
  });

  it('unoPlay（カード記録なしの古いログ）でも文言は出る', () => {
    const r = summarizeUnoEntry(e('unoPlay', 'p1', { cardIdx: 0, chosenColor: null }));
    expect(r.card).toBeNull();
    expect(r.text).toContain('カードを出した');
  });

  it('unoDraw は枚数付き', () => {
    expect(summarizeUnoEntry(e('unoDraw', 'p1', { count: 1 })).text).toBe('1枚引いた');
    expect(summarizeUnoEntry(e('unoDraw', 'p1', { count: 4 })).text).toBe('ペナルティ4枚引いた');
    expect(summarizeUnoEntry(e('unoDraw', 'p1', {})).text).toBe('1枚引いた');
  });

  it('sayUno / unoSkip / pickParentColor', () => {
    expect(summarizeUnoEntry(e('sayUno', 'p1')).text).toContain('UNO宣言');
    expect(summarizeUnoEntry(e('unoSkip', 'p1')).text).toBe('出し切りスキップ');
    expect(summarizeUnoEntry(e('pickParentColor', 'p1', { color: 'green' })).text).toContain('緑に変更');
  });
});
