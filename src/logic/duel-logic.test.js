// ========================================
// duel-logic.ts 単体テスト（対決の状態遷移・挑戦可否）
// ========================================
import { describe, it, expect } from 'vitest';
import { newDuel, canChallenge, currentActorId, applyRoll, applyCommit } from './duel-logic.ts';

const yachtRoom = (over = {}) => ({
  mode: 'yacht', state: 'playing', duel: null, skillUsed: {},
  players: [
    { id: 'me', name: 'A' }, { id: 'p2', name: 'B' },
    { id: 'bot-1', name: '🤖', isBot: true },
  ],
  game: { order: ['me', 'p2'], ci: 0, rankings: [] },
  ...over,
});

describe('canChallenge — 挑戦可否', () => {
  it('ヨットモード・自分の手番・未使用なら挑める', () => {
    expect(canChallenge(yachtRoom(), 'me', 'p2').ok).toBe(true);
  });
  it('クラシックモードでは挑めない', () => {
    expect(canChallenge(yachtRoom({ mode: 'classic' }), 'me', 'p2').ok).toBe(false);
  });
  it('自分の手番でないと挑めない', () => {
    expect(canChallenge(yachtRoom(), 'p2', 'me').ok).toBe(false);
  });
  it('スキル使用済みは挑めない', () => {
    expect(canChallenge(yachtRoom({ skillUsed: { me: true } }), 'me', 'p2').ok).toBe(false);
  });
  it('対決進行中は挑めない', () => {
    expect(canChallenge(yachtRoom({ duel: {} }), 'me', 'p2').ok).toBe(false);
  });
  it('ボットにはまだ挑めない（Step 3で解放）', () => {
    expect(canChallenge(yachtRoom(), 'me', 'bot-1').ok).toBe(false);
  });
  it('順位確定者には挑めない', () => {
    const room = yachtRoom();
    room.game.rankings = [{ id: 'p2', name: 'B' }];
    expect(canChallenge(room, 'me', 'p2').ok).toBe(false);
  });
  it('自分自身には挑めない', () => {
    expect(canChallenge(yachtRoom(), 'me', 'me').ok).toBe(false);
  });
});

describe('対決フロー — 攻撃側先攻 → 守備側 → 決着', () => {
  it('newDuel は攻撃側の手番から始まる', () => {
    const d = newDuel('me', 'p2', 1000);
    expect(d.turn).toBe('attacker');
    expect(currentActorId(d)).toBe('me');
    expect(d.attacker.rollsLeft).toBe(3);
  });

  it('roll → commit で攻撃側確定・守備側の番へ', () => {
    let d = newDuel('me', 'p2', 0);
    d = applyRoll(d, null, () => 0.99); // 全部6
    expect(d.attacker.dice).toEqual([6, 6, 6, 6, 6]);
    expect(d.attacker.rollsLeft).toBe(2);
    d = applyCommit(d);
    expect(d.attacker.done).toBe(true);
    expect(d.attacker.best).toEqual({ category: 'yacht', score: 50 });
    expect(d.turn).toBe('defender');
    expect(currentActorId(d)).toBe('p2');
  });

  it('keepFlags で残した目は振り直されない', () => {
    let d = newDuel('me', 'p2', 0);
    d = applyRoll(d, null, () => 0.99);           // 66666
    d = applyRoll(d, [true, true, false, false, false], () => 0); // 66111
    expect(d.attacker.dice).toEqual([6, 6, 1, 1, 1]);
    expect(d.attacker.rollsLeft).toBe(1);
  });

  it('3回振り切ったら4回目は不可（null）', () => {
    let d = newDuel('me', 'p2', 0);
    d = applyRoll(d, null, () => 0);
    d = applyRoll(d, [false,false,false,false,false], () => 0);
    d = applyRoll(d, [false,false,false,false,false], () => 0);
    expect(d.attacker.rollsLeft).toBe(0);
    expect(applyRoll(d, null, () => 0)).toBeNull();
  });

  it('振る前の commit は不可（null）', () => {
    const d = newDuel('me', 'p2', 0);
    expect(applyCommit(d)).toBeNull();
  });

  it('守備側 commit で決着（高得点勝ち・winnerId設定）', () => {
    let d = newDuel('me', 'p2', 0);
    d = applyRoll(d, null, () => 0);   // 攻撃 11111 = yacht 50
    d = applyCommit(d);
    d = applyRoll(d, null, () => 0.5); // 守備 44444 = yacht 50 → draw
    d = applyCommit(d);
    expect(d.stage).toBe('done');
    expect(d.result).toBe('draw');
    expect(d.winnerId).toBeNull();
  });

  it('守備側が高得点なら defender 勝ち', () => {
    let d = newDuel('me', 'p2', 0);
    // 攻撃: バラバラ低スコア
    d = { ...d, attacker: { dice: [1,1,2,2,3], rollsLeft: 0, done: true, best: { category:'choice', score: 9 } }, turn: 'defender' };
    d = applyRoll(d, null, () => 0.99); // 守備 66666
    d = applyCommit(d);
    expect(d.result).toBe('defender');
    expect(d.winnerId).toBe('p2');
  });

  it('決着後は roll/commit とも不可', () => {
    let d = newDuel('me', 'p2', 0);
    d = applyRoll(d, null, () => 0); d = applyCommit(d);
    d = applyRoll(d, null, () => 0); d = applyCommit(d);
    expect(d.stage).toBe('done');
    expect(applyRoll(d, null, () => 0)).toBeNull();
    expect(applyCommit(d)).toBeNull();
  });

  it('RTDBの空配列消失（dice欠落）でも初回roll扱いで動く', () => {
    const d = newDuel('me', 'p2', 0);
    delete d.attacker.dice; // RTDB経由で消えた想定
    const rolled = applyRoll(d, null, () => 0);
    expect(rolled.attacker.dice).toEqual([1,1,1,1,1]);
  });
});
