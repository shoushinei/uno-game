// ========================================
// mobile-layout.ts 単体テスト
//
// 描画そのものはDOM依存だが、「どの色にするか」「何と書くか」の判定は
// 純粋関数に切り出してあるのでここで固める。
// ========================================
import { describe, it, expect, beforeEach } from 'vitest';
import { feltColorClass, buildNote, takeReactionEvents, resetHitToast } from './mobile-layout.js';

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

  // ★この行は高さ20px固定★ 空にすると行が消えて操作エリアの高さが動くため、
  // 自分の番でなくても必ず何か返す。折り返しも同じ理由で禁止。
  it('自分の番でなくても空にせず、手札の枚数を出す', () => {
    expect(buildNote({ ...base, isMyTurn: false })).toBe('🃏 13 ／ 🎴 7');
  });

  it('どの場面でも1行に収まる短さに保つ', () => {
    const cases = [
      { ...base, isMyTurn: false },
      { ...base },
      { ...base, trumpCount: 0 },
      { ...base, phase: 'uno' },
      { ...base, phase: 'uno', unoCount: 0 },
      { ...base, phase: 'uno', penaltyAccum: 4 },
      { ...base, phase: 'uno', unoCount: 2, needsUnoCall: true },
      { ...base, trumpCount: 0, autoAdvancing: true },
      { ...base, iFinished: true, myRank: 8 },
    ];
    for (const c of cases) {
      // 全角換算で約24文字。11pxで375px幅に収まる上限（実測に基づく）
      const width = [...buildNote(c)].reduce((n, ch) => n + (/[\x20-\x7E]/.test(ch) ? 0.5 : 1), 0);
      expect(width, buildNote(c)).toBeLessThanOrEqual(24);
    }
  });

  it('上がり済みなら順位を出す', () => {
    expect(buildNote({ ...base, iFinished: true, myRank: 2 })).toBe('🏁 2位で上がり — 観戦中');
  });

  it('順位が不明でも上がりは伝える', () => {
    expect(buildNote({ ...base, iFinished: true, myRank: null })).toBe('🏁 上がり — 観戦中');
  });

  it('トランプフェイズでは枚数を🃏付きで出す', () => {
    expect(buildNote(base)).toBe('🃏 13枚 — 出すカードを選ぶ');
  });

  it('トランプ0枚なら次へ進む案内に切り替わる', () => {
    expect(buildNote({ ...base, trumpCount: 0 })).toContain('「進む」');
  });

  it('UNOフェイズでは枚数を🎴付きで出す', () => {
    expect(buildNote({ ...base, phase: 'uno' })).toBe('🎴 7枚 — 同じ色か同じ数字を1枚');
  });

  it('UNO0枚なら次へ進む案内に切り替わる', () => {
    expect(buildNote({ ...base, phase: 'uno', unoCount: 0 })).toContain('「進む」');
  });

  it('自動進行中はボタンを押させず「自動で進む」と伝える', () => {
    const s = buildNote({ ...base, trumpCount: 0, autoAdvancing: true });
    expect(s).toContain('自動で次へ進みます');
    expect(s).not.toContain('押してください');
  });

  it('自動進行中でも自分の番でなければ枚数表示のまま', () => {
    expect(buildNote({ ...base, isMyTurn: false, autoAdvancing: true })).toBe('🃏 13 ／ 🎴 7');
  });

  it('上がり済みの表示は自動進行より優先される', () => {
    const s = buildNote({ ...base, iFinished: true, myRank: 1, autoAdvancing: true });
    expect(s).toContain('1位で上がり');
  });

  it('累積ペナルティは他の案内より優先して警告する', () => {
    const s = buildNote({ ...base, phase: 'uno', penaltyAccum: 4, needsUnoCall: true });
    expect(s).toContain('+4 累積中');
  });

  it('UNO宣言が必要なら宣言を促す', () => {
    const s = buildNote({ ...base, phase: 'uno', unoCount: 2, needsUnoCall: true });
    expect(s).toBe('📢 UNO! を押してから出す（🎴 2）');
  });

  it('「トランプ」「UNO」を数える語ではなくマークで示している', () => {
    // 枚数表記そのものは 🃏 / 🎴 のマークで導く（行ラベルを廃した代わり）
    expect(buildNote(base)).toMatch(/🃏 \d+枚/);
    expect(buildNote({ ...base, phase: 'uno' })).toMatch(/🎴 \d+枚/);
  });
});

// ----------------------------------------
// リアクションの検知
// ----------------------------------------
describe('takeReactionEvents', () => {
  const PLAYERS = [{ id: 'me', name: 'わたし' }, { id: 'p2', name: 'ボブ' }, { id: 'p3', name: 'キャロル' }];
  const noBlock = () => false;
  const NOW = 1_000_000;

  beforeEach(() => { resetHitToast(); });

  const take = (reactions, now = NOW, isBlocked = noBlock) =>
    takeReactionEvents(reactions, 'me', PLAYERS, now, isBlocked);

  it('初回同期では既読にするだけで何も返さない（再接続で一斉に出ない）', () => {
    expect(take({ p2: { emoji: '🍅', ts: NOW - 100, targetId: 'me' } })).toEqual([]);
  });

  it('★自分が投げたリアクションも返す★', () => {
    // ここが以前の穴。送信者は②のチップ一覧に並ばないので、
    // 自分が投げたぶんを返さないと画面のどこにも出ない
    take({});
    const [ev] = take({ me: { emoji: '🍅', ts: NOW, targetId: 'p3' } });
    expect(ev).toMatchObject({ fromId: 'me', targetId: 'p3', emoji: '🍅', toMe: false });
  });

  it('自分が宛先なら toMe が立つ（被弾トースト・着弾音の対象）', () => {
    take({});
    const [ev] = take({ p2: { emoji: '💋', ts: NOW, targetId: 'me' } });
    expect(ev).toMatchObject({ fromId: 'p2', fromName: 'ボブ', toMe: true });
  });

  it('全体向け（targetId無し）は targetId が null で toMe も false', () => {
    take({});
    const [ev] = take({ p2: { emoji: '🎉', ts: NOW } });
    expect(ev).toMatchObject({ targetId: null, toMe: false });
  });

  it('同じ ts を二度返さない（再描画で重複しない）', () => {
    take({});
    const r = { p2: { emoji: '🍅', ts: NOW, targetId: 'p3' } };
    expect(take(r)).toHaveLength(1);
    expect(take(r)).toHaveLength(0);
  });

  it('8秒以上前のものは返さない（再接続時の一斉再生よけ）', () => {
    take({});
    expect(take({ p2: { emoji: '🍅', ts: NOW - 8000, targetId: 'p3' } })).toEqual([]);
  });

  it('ブロックは対人リアクションにだけ効く', () => {
    take({});
    const blocked = (id) => id === 'p2';
    expect(take({ p2: { emoji: '🍅', ts: NOW, targetId: 'p3' } }, NOW, blocked)).toEqual([]);
    expect(take({ p2: { emoji: '🎉', ts: NOW + 1 } }, NOW, blocked)).toHaveLength(1);
  });

  it('複数人が同時に投げても全部返す', () => {
    take({});
    const evs = take({
      p2: { emoji: '🍅', ts: NOW, targetId: 'me' },
      p3: { emoji: '💐', ts: NOW, targetId: 'p2' },
    });
    expect(evs).toHaveLength(2);
  });
});
