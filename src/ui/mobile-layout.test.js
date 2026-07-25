// ========================================
// mobile-layout.ts 単体テスト
//
// 描画そのものはDOM依存だが、「どの色にするか」「何と書くか」の判定は
// 純粋関数に切り出してあるのでここで固める。
// ========================================
import { describe, it, expect } from 'vitest';
import { feltColorClass, buildNote } from './mobile-layout.js';

describe('feltColorClass', () => {
  it('UNOの4色をフェルトのクラスに対応させる', () => {
    expect(feltColorClass('red')).toBe('c-red');
    expect(feltColorClass('blue')).toBe('c-blue');
    expect(feltColorClass('green')).toBe('c-green');
    expect(feltColorClass('yellow')).toBe('c-yellow');
  });

  it('色が未確定なら null（CSS既定の緑フェルトのまま）', () => {
    expect(feltColorClass(null)).toBeNull();
    expect(feltColorClass(undefined)).toBeNull();
    expect(feltColorClass('')).toBeNull();
    expect(feltColorClass('rainbow')).toBeNull();
  });
});

describe('buildNote', () => {
  const base = {
    isMyTurn: true, iFinished: false, phase: 'trump',
    trumpCount: 13, unoCount: 7, penaltyAccum: 0, needsUnoCall: false, myRank: null,
  };

  it('自分の番でなければ空（行ごと消える）', () => {
    expect(buildNote({ ...base, isMyTurn: false })).toBe('');
  });

  it('上がり済みなら順位を出す', () => {
    expect(buildNote({ ...base, iFinished: true, myRank: 2 })).toBe('🏁 2位で上がり — 観戦中');
  });

  it('順位が不明でも上がりは伝える', () => {
    expect(buildNote({ ...base, iFinished: true, myRank: null })).toBe('🏁 上がり — 観戦中');
  });

  it('トランプフェイズでは枚数を🃏付きで出す', () => {
    expect(buildNote(base)).toBe('出したいトランプを選んでください（🃏 13枚）');
  });

  it('トランプ0枚なら次へ進む案内に切り替わる', () => {
    expect(buildNote({ ...base, trumpCount: 0 })).toContain('UNOへ進む');
  });

  it('UNOフェイズでは枚数を🎴付きで出す', () => {
    expect(buildNote({ ...base, phase: 'uno' })).toBe('同じ色か同じ数字を1枚（🎴 7枚）');
  });

  it('UNO0枚なら次へ進む案内に切り替わる', () => {
    expect(buildNote({ ...base, phase: 'uno', unoCount: 0 })).toContain('次へ進む');
  });

  it('累積ペナルティは他の案内より優先して警告する', () => {
    const s = buildNote({ ...base, phase: 'uno', penaltyAccum: 4, needsUnoCall: true });
    expect(s).toContain('+4 累積中');
    expect(s).toContain('🎴 7枚');
  });

  it('UNO宣言が必要なら宣言を促す', () => {
    const s = buildNote({ ...base, phase: 'uno', unoCount: 2, needsUnoCall: true });
    expect(s).toBe('出す前に 📢UNO! を押してください（🎴 2枚）');
  });

  it('「トランプ」「UNO」を数える語ではなくマークで示している', () => {
    // 枚数表記そのものは 🃏 / 🎴 のマークで導く（行ラベルを廃した代わり）
    expect(buildNote(base)).toMatch(/🃏 \d+枚/);
    expect(buildNote({ ...base, phase: 'uno' })).toMatch(/🎴 \d+枚/);
  });
});
