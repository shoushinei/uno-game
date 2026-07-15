// ========================================
// lobby-bots.ts 単体テスト（ボット生成と権限判定）
// ========================================
import { describe, it, expect } from 'vitest';
import {
  pickBotName,
  makeBotPlayer,
  isBotPlayer,
  canAddBot,
  canRemoveBot,
  botPlayerMap,
  MAX_ROOM_PLAYERS,
} from './lobby-bots.js';

describe('pickBotName — 名前の重複回避', () => {
  it('空なら先頭のプール名を返す', () => {
    expect(pickBotName([])).toBe('🤖ポンタ');
  });

  it('使用済みの名前は避ける', () => {
    const name = pickBotName([{ name: '🤖ポンタ' }, { name: '🤖ガブ' }]);
    expect(name).toBe('🤖モモ');
  });

  it('プールが尽きたら連番でフォールバックする', () => {
    const used = ['🤖ポンタ','🤖ガブ','🤖モモ','🤖クロ','🤖ピノ','🤖チビ','🤖リン','🤖ハチ']
      .map(n => ({ name: n }));
    expect(pickBotName(used)).toBe('🤖ボット1');
  });
});

describe('makeBotPlayer', () => {
  it('isBot:true・ready:true で重複しない名前のボットを作る', () => {
    const players = [{ name: '🤖ポンタ' }];
    const bot = makeBotPlayer(players);
    expect(bot.isBot).toBe(true);
    expect(bot.ready).toBe(true);
    expect(bot.name).toBe('🤖ガブ');
    expect(bot.id.startsWith('bot-')).toBe(true);
    expect(bot.bi).toBe(1);
  });

  it('isBotPlayer は isBot フラグを見る', () => {
    expect(isBotPlayer({ id: 'x', name: 'a', isBot: true })).toBe(true);
    expect(isBotPlayer({ id: 'x', name: 'a' })).toBe(false);
    expect(isBotPlayer(null)).toBe(false);
  });
});

describe('canAddBot — 追加権限', () => {
  const room = (over = {}) => ({
    state: 'lobby', host: 'h', players: [{ id: 'h', name: 'ホスト' }], ...over,
  });

  it('ホスト・ロビー中・満員でなければ追加可', () => {
    expect(canAddBot(room(), 'h')).toBe(true);
  });
  it('ホスト以外は不可', () => {
    expect(canAddBot(room(), 'p2')).toBe(false);
  });
  it('ロビー中以外は不可', () => {
    expect(canAddBot(room({ state: 'playing' }), 'h')).toBe(false);
  });
  it('満員(8人)なら不可', () => {
    const players = Array.from({ length: MAX_ROOM_PLAYERS }, (_, i) => ({ id: 'p' + i, name: 'p' + i }));
    expect(canAddBot(room({ players }), 'h')).toBe(false);
  });
  it('room が null なら不可', () => {
    expect(canAddBot(null, 'h')).toBe(false);
  });
});

describe('canRemoveBot — 削除権限', () => {
  const room = (over = {}) => ({
    state: 'lobby', host: 'h',
    players: [{ id: 'h', name: 'ホスト' }, { id: 'bot-1', name: '🤖ポンタ', isBot: true }, { id: 'p2', name: '人間' }],
    ...over,
  });

  it('ホストが実在のボットを削除するのは可', () => {
    expect(canRemoveBot(room(), 'h', 'bot-1')).toBe(true);
  });
  it('人間プレイヤーは削除対象にできない', () => {
    expect(canRemoveBot(room(), 'h', 'p2')).toBe(false);
  });
  it('存在しないIDは不可', () => {
    expect(canRemoveBot(room(), 'h', 'nope')).toBe(false);
  });
  it('ホスト以外は不可', () => {
    expect(canRemoveBot(room(), 'p2', 'bot-1')).toBe(false);
  });
  it('ゲーム中は不可', () => {
    expect(canRemoveBot(room({ state: 'playing' }), 'h', 'bot-1')).toBe(false);
  });
});

describe('botPlayerMap', () => {
  it('isBot のプレイヤーだけを { id: true } にする', () => {
    const players = [
      { id: 'h', name: 'ホスト' },
      { id: 'b1', name: '🤖A', isBot: true },
      { id: 'b2', name: '🤖B', isBot: true },
    ];
    expect(botPlayerMap(players)).toEqual({ b1: true, b2: true });
  });
  it('null/undefined でも空オブジェクト', () => {
    expect(botPlayerMap(null)).toEqual({});
    expect(botPlayerMap(undefined)).toEqual({});
  });
});
