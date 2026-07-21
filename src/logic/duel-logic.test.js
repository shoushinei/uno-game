// ========================================
// duel-logic.ts 単体テスト（対決の状態遷移・挑戦可否）
// ========================================
import { describe, it, expect } from 'vitest';
import { newDuel, canChallenge, currentActorId, applyRoll, applyCommit, decideDuelMove } from './duel-logic.ts';

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
  it('ボットにも挑める（Step 3で解放・手番はホスト代行）', () => {
    const room = yachtRoom();
    room.game.order = ['me', 'p2', 'bot-1'];
    expect(canChallenge(room, 'me', 'bot-1').ok).toBe(true);
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

describe('decideDuelMove — ボット/退室者の代行AI（Step 3）', () => {
  const withAttacker = (dice, rollsLeft, atkScore = null) => {
    let d = newDuel('bot-1', 'p2', 0);
    d = { ...d, attacker: { dice, rollsLeft, done: false, best: null } };
    if (atkScore !== null) {
      d = { ...d, attacker: { dice: [1,1,2,2,3], rollsLeft: 0, done: true, best: { category:'choice', score: atkScore } },
        turn: 'defender', defender: { dice, rollsLeft, done: false, best: null } };
    }
    return d;
  };

  it('まだ振っていなければ全部振る', () => {
    expect(decideDuelMove(withAttacker([], 3))).toEqual({ type: 'roll', keep: null });
  });
  it('振り直し不可なら確定', () => {
    expect(decideDuelMove(withAttacker([1,2,3,5,6], 0))).toEqual({ type: 'commit' });
  });
  it('ビッグストレート級（30点以上）は確定', () => {
    expect(decideDuelMove(withAttacker([1,2,3,4,5], 2))).toEqual({ type: 'commit' });
  });
  it('弱い手は最頻値を残して振り直す（同数なら大きい目）', () => {
    const m = decideDuelMove(withAttacker([3,3,5,5,1], 2));
    expect(m.type).toBe('roll');
    expect(m.keep).toEqual([false,false,true,true,false]); // 5を残す
  });
  it('守備側は攻撃側のスコアを超えた時点で即確定', () => {
    // 守備の手: 4,4,4,1,2 = フォーナンバーズ未満…choice15 > 攻撃9 → commit
    const d = withAttacker([4,4,4,1,2], 2, 9);
    expect(decideDuelMove(d)).toEqual({ type: 'commit' });
  });
  it('守備側でもまだ負けていれば振り直す', () => {
    const d = withAttacker([1,1,2,2,3], 2, 28);
    expect(decideDuelMove(d).type).toBe('roll');
  });
  it('決着後は null', () => {
    let d = newDuel('a', 'b', 0);
    d = { ...d, stage: 'done' };
    expect(decideDuelMove(d)).toBeNull();
  });
});
