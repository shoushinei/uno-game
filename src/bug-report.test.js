// ========================================
// bug-report-logic.ts 単体テスト（ペイロード組み立て・切り詰め・クールダウン）
// ※ Firebase・DOM に触れる部分（installErrorCapture / submitBugReport）は
//   ブラウザ＋エミュレータで検証する。ここは純粋部分のみ。
// ========================================
import { describe, it, expect } from 'vitest';
import {
  safeJson, truncateForReport, canSubmit, buildBugReportPayload,
  MAX_DESCRIPTION, MAX_SNAPSHOT_CHARS, SUBMIT_COOLDOWN_MS,
} from './bug-report-logic.ts';

const baseInput = (over = {}) => ({
  description: 'カードが出せない',
  room: { state: 'playing', game: { ci: 0 } },
  replay: { version: 1, actionLog: [] },
  errors: [{ ts: 1, msg: 'boom' }],
  uid: 'u1', name: 'テスト', roomId: 'ABCD',
  uiMode: 'pc', userAgent: 'UA',
  ...over,
});

describe('safeJson', () => {
  it('普通のオブジェクトを直列化する', () => {
    expect(safeJson({ a: 1 })).toBe('{"a":1}');
  });
  it('循環参照でも落ちない', () => {
    const o = { a: 1 };
    o.self = o;
    expect(safeJson(o)).toContain('[circular]');
  });
});

describe('truncateForReport', () => {
  it('上限内はそのまま', () => {
    expect(truncateForReport('abc', 5)).toEqual({ text: 'abc', truncated: false });
  });
  it('上限超過は切り詰めてフラグを立てる', () => {
    const r = truncateForReport('a'.repeat(10), 5);
    expect(r.text).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });
});

describe('canSubmit — クールダウン', () => {
  it('初回（lastAt=0）は送れる', () => {
    expect(canSubmit(Date.now(), 0)).toBe(true);
  });
  it('クールダウン中は送れない・経過後は送れる', () => {
    const t = 1_000_000;
    expect(canSubmit(t + SUBMIT_COOLDOWN_MS - 1, t)).toBe(false);
    expect(canSubmit(t + SUBMIT_COOLDOWN_MS, t)).toBe(true);
  });
});

describe('buildBugReportPayload', () => {
  it('全フィールドが揃い、添付はJSON文字列になる', () => {
    const p = buildBugReportPayload(baseInput());
    expect(p.uid).toBe('u1');
    expect(p.uiMode).toBe('pc');
    expect(p.description).toBe('カードが出せない');
    expect(JSON.parse(p.roomSnapshot).state).toBe('playing');
    expect(JSON.parse(p.replay).version).toBe(1);
    expect(JSON.parse(p.recentErrors)[0].msg).toBe('boom');
    expect(p.truncated).toBe(false);
  });
  it('room/replay が null なら空文字列', () => {
    const p = buildBugReportPayload(baseInput({ room: null, replay: null }));
    expect(p.roomSnapshot).toBe('');
    expect(p.replay).toBe('');
  });
  it('説明文は前後空白を除去し上限で切り詰め、truncated が立つ', () => {
    const p = buildBugReportPayload(baseInput({ description: '  ' + 'あ'.repeat(MAX_DESCRIPTION + 100) }));
    expect(p.description).toHaveLength(MAX_DESCRIPTION);
    expect(p.truncated).toBe(true);
  });
  it('巨大なスナップショットも上限内に収まる', () => {
    const big = { data: 'x'.repeat(MAX_SNAPSHOT_CHARS + 1000) };
    const p = buildBugReportPayload(baseInput({ room: big }));
    expect(p.roomSnapshot.length).toBe(MAX_SNAPSHOT_CHARS);
    expect(p.truncated).toBe(true);
  });
});
