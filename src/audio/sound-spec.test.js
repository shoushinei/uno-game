// ========================================
// sound-spec.ts 単体テスト
//
// audio-engine.ts は AudioContext に依存するため vitest では読めない。
// 効果音まわりで検証できるのは「音の定義」と「出来事→音の対応」だけなので、
// そこに壊れやすい部分（対応漏れ・不正な数値）を寄せてある。
// ========================================
import { describe, it, expect } from 'vitest';
import {
  SOUND_SPECS,
  soundForEffect,
  soundForSpecial,
  specDuration,
} from './sound-spec.js';

// ----------------------------------------
// 音色テーブルの健全性
// ----------------------------------------
describe('SOUND_SPECS', () => {
  const entries = Object.entries(SOUND_SPECS);

  it('すべての音が1つ以上のレイヤーを持つ', () => {
    for (const [id, spec] of entries) {
      expect(spec.layers.length, `${id} にレイヤーが無い`).toBeGreaterThan(0);
    }
  });

  it('周波数は正の値（指数スイープは0を扱えないため）', () => {
    for (const [id, spec] of entries) {
      for (const l of spec.layers) {
        expect(l.freq, `${id} の freq`).toBeGreaterThan(0);
        if (l.freqTo !== undefined) expect(l.freqTo, `${id} の freqTo`).toBeGreaterThan(0);
      }
    }
  });

  it('音量は 0 より大きく 1 以下', () => {
    for (const [id, spec] of entries) {
      expect(spec.gain, `${id} の全体音量`).toBeGreaterThan(0);
      for (const l of spec.layers) {
        expect(l.gain, `${id} のレイヤー音量`).toBeGreaterThan(0);
        expect(l.gain, `${id} のレイヤー音量`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('start は0以上・dur は正', () => {
    for (const [id, spec] of entries) {
      for (const l of spec.layers) {
        expect(l.start, `${id} の start`).toBeGreaterThanOrEqual(0);
        expect(l.dur, `${id} の dur`).toBeGreaterThan(0);
      }
    }
  });

  it('1音は1.2秒を超えない（連続する操作に置いていかれないため）', () => {
    for (const [id, spec] of entries) {
      expect(specDuration(spec), `${id} が長すぎる`).toBeLessThanOrEqual(1.2);
    }
  });

  it('毎秒鳴る timer-tick は極端に短い', () => {
    expect(specDuration(SOUND_SPECS['timer-tick'])).toBeLessThanOrEqual(0.1);
  });
});

describe('specDuration', () => {
  it('最も遅く終わるレイヤーの終了時刻を返す', () => {
    const spec = {
      gain: 1,
      layers: [
        { wave: 'sine', freq: 440, start: 0, dur: 0.5, gain: 0.2 },
        { wave: 'sine', freq: 440, start: 0.3, dur: 0.1, gain: 0.2 },
        { wave: 'sine', freq: 440, start: 0.2, dur: 0.45, gain: 0.2 },
      ],
    };
    expect(specDuration(spec)).toBeCloseTo(0.65);
  });

  it('レイヤーが無ければ0', () => {
    expect(specDuration({ gain: 1, layers: [] })).toBe(0);
  });
});

// ----------------------------------------
// 出来事 → 音 の対応
// ----------------------------------------
describe('soundForEffect', () => {
  it('主要な演出すべてに音が割り当たっている', () => {
    const cases = [
      [{ kind: 'game-start', firstPlayerName: 'A', seatIds: [] }, 'game-start'],
      [{ kind: 'trump-play', playerId: 'p1', cards: [] }, 'trump-play'],
      [{ kind: 'uno-play', playerId: 'p1', card: null }, 'uno-play'],
      [{ kind: 'draw', playerId: 'p1', count: 2 }, 'draw'],
      [{ kind: 'pass', playerId: 'p1' }, 'pass'],
      [{ kind: 'say-uno', playerId: 'p1' }, 'say-uno'],
      [{ kind: 'parent-color', playerId: 'p1', color: 'red' }, 'parent-color'],
      [{ kind: 'field-clear', parentId: 'p1' }, 'field-clear'],
      [{ kind: 'reverse', dir: -1 }, 'reverse'],
      [{ kind: 'finish', playerId: 'p1', rank: 1 }, 'finish'],
    ];
    for (const [desc, expected] of cases) {
      expect(soundForEffect(desc), `${desc.kind}`).toBe(expected);
    }
  });

  it('割り当てた音IDはすべて SOUND_SPECS に存在する', () => {
    const kinds = [
      { kind: 'game-start', firstPlayerName: 'A', seatIds: [] },
      { kind: 'trump-play', playerId: 'p1', cards: [] },
      { kind: 'uno-play', playerId: 'p1', card: null },
      { kind: 'draw', playerId: 'p1', count: 1 },
      { kind: 'pass', playerId: 'p1' },
      { kind: 'say-uno', playerId: 'p1' },
      { kind: 'parent-color', playerId: 'p1', color: 'red' },
      { kind: 'field-clear', parentId: null },
      { kind: 'reverse', dir: 1 },
      { kind: 'finish', playerId: 'p1', rank: 1 },
      { kind: 'trump-special', types: ['eightCut'], playerId: 'p1', revolutionOn: false },
    ];
    for (const desc of kinds) {
      const id = soundForEffect(desc);
      expect(id, `${desc.kind} の音IDが未定義`).not.toBeNull();
      expect(SOUND_SPECS[id], `${id} が SOUND_SPECS に無い`).toBeDefined();
    }
  });

  it('未知の演出では null を返す（音を鳴らさない）', () => {
    expect(soundForEffect({ kind: 'unknown-effect' })).toBeNull();
  });
});

describe('soundForSpecial', () => {
  it('特殊効果ごとの音を返す', () => {
    expect(soundForSpecial(['eightCut'])).toBe('cut');
    expect(soundForSpecial(['revolution'])).toBe('revolution');
    expect(soundForSpecial(['suitLock'])).toBe('suit-lock');
    expect(soundForSpecial(['elevenBack'])).toBe('eleven-back');
    expect(soundForSpecial(['jokerSingle'])).toBe('joker');
    expect(soundForSpecial(['spadeThree'])).toBe('spade-three');
  });

  it('同時に複数立ったら優先度の高い1つだけを鳴らす（重ねると濁るため）', () => {
    // 革命は最優先
    expect(soundForSpecial(['suitLock', 'revolution', 'eightCut'])).toBe('revolution');
    // 革命が無ければジョーカー
    expect(soundForSpecial(['suitLock', 'eightCut', 'jokerSingle'])).toBe('joker');
    // 8切り＋しばりの同時発動は8切りを採る
    expect(soundForSpecial(['suitLock', 'eightCut'])).toBe('cut');
  });

  it('該当が無ければ null', () => {
    expect(soundForSpecial([])).toBeNull();
    expect(soundForSpecial(['somethingElse'])).toBeNull();
  });
});
