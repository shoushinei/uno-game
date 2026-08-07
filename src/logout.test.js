// ========================================
// ログアウト／アカウント切替の純粋ロジックのテスト
//
// signOut は Firebase を直 import するので vitest では読めない。
// 判定・文言・「消すキー／残すキー」の一覧だけをここで固定する。
// ========================================
import { describe, it, expect } from 'vitest';
import {
  accountKind,
  accountKindLabel,
  planLogout,
  buildAccountMenuHtml,
  escapeHtml,
  LOGOUT_CLEAR_KEYS,
  KEEP_KEYS,
} from './logout-logic.ts';

describe('accountKind', () => {
  it('匿名ユーザーはゲスト', () => {
    expect(accountKind({ isAnonymous: true, providerIds: [] })).toBe('guest');
  });

  it('未ログイン(null)もゲスト扱い', () => {
    expect(accountKind(null)).toBe('guest');
  });

  it('google.com を持っていれば google', () => {
    expect(accountKind({ isAnonymous: false, providerIds: ['google.com'] })).toBe('google');
  });

  it('メールリンクは providerId が password なので email', () => {
    expect(accountKind({ isAnonymous: false, providerIds: ['password'] })).toBe('email');
  });

  it('provider が読めなくてもゲストには倒さない（「戻れません」と脅さない）', () => {
    expect(accountKind({ isAnonymous: false, providerIds: [] })).toBe('email');
    expect(accountKind({ isAnonymous: false })).toBe('email');
  });

  it('ラベルは3種とも日本語で出る', () => {
    for (const k of ['google', 'email', 'guest']) {
      expect(accountKindLabel(k).length).toBeGreaterThan(0);
    }
    expect(accountKindLabel('guest')).toContain('ゲスト');
  });
});

describe('planLogout', () => {
  it('ルームに居なければ退室不要で、退室の話も出さない', () => {
    const p = planLogout({ kind: 'google', roomState: null, intent: 'logout' });
    expect(p.needsLeave).toBe(false);
    expect(p.confirmText).not.toContain('退室');
    expect(p.confirmText).toContain('ログアウト');
  });

  it('ロビーに居れば退室が要ることを伝える', () => {
    const p = planLogout({ kind: 'google', roomState: 'lobby', intent: 'logout' });
    expect(p.needsLeave).toBe(true);
    expect(p.confirmText).toContain('退室');
  });

  it('ゲーム中はボットが代行することを伝える', () => {
    const p = planLogout({ kind: 'google', roomState: 'playing', intent: 'logout' });
    expect(p.needsLeave).toBe(true);
    expect(p.confirmText).toContain('ボット');
  });

  it('リザルト画面（ended）でも退室が要る', () => {
    const p = planLogout({ kind: 'google', roomState: 'ended', intent: 'logout' });
    expect(p.needsLeave).toBe(true);
    expect(p.confirmText).toContain('退室');
  });

  it('★ゲストのログアウトは片道であることを必ず言う★', () => {
    const p = planLogout({ kind: 'guest', roomState: null, intent: 'logout' });
    expect(p.confirmText).toContain('戻れません');
  });

  it('アカウント持ちには「戻れません」と言わない', () => {
    const p = planLogout({ kind: 'google', roomState: null, intent: 'logout' });
    expect(p.confirmText).not.toContain('戻れません');
  });

  it('切替は「別のアカウント」と言う', () => {
    const p = planLogout({ kind: 'google', roomState: null, intent: 'switch' });
    expect(p.confirmText).toContain('別のアカウント');
  });

  it('確認文は必ず問いかけで終わる（1回で答えられる形）', () => {
    for (const roomState of [null, 'lobby', 'playing', 'ended']) {
      for (const kind of ['google', 'email', 'guest']) {
        for (const intent of ['logout', 'switch']) {
          const p = planLogout({ kind, roomState, intent });
          expect(p.confirmText.endsWith('よろしいですか？')).toBe(true);
        }
      }
    }
  });
});

describe('localStorage の消す／残す', () => {
  it('★消すキーと残すキーが重ならない★', () => {
    const overlap = LOGOUT_CLEAR_KEYS.filter((k) => KEEP_KEYS.includes(k));
    expect(overlap).toEqual([]);
  });

  it('セッション復帰の鍵とメールアドレスは消す', () => {
    for (const k of ['savedRoomId', 'savedMyId', 'savedMyName', 'savedIsHost', 'emailForSignIn']) {
      expect(LOGOUT_CLEAR_KEYS).toContain(k);
    }
  });

  it('★端末の設定（効果音・触覚・ブロック・引き出し）は消さない★', () => {
    for (const k of ['pcgSoundOff', 'pcgHapticOff', 'pcgReactionsOff', 'pcgBlockedReactors', 'pcgDrawerOpen', 'pcgDrawerTab']) {
      expect(KEEP_KEYS).toContain(k);
      expect(LOGOUT_CLEAR_KEYS).not.toContain(k);
    }
  });

  it('uid 付きの実績既読キーは消す対象に入っていない', () => {
    expect(LOGOUT_CLEAR_KEYS.some((k) => k.startsWith('seenAchv'))).toBe(false);
  });
});

describe('buildAccountMenuHtml', () => {
  const base = { name: 'しょうしねい', kind: 'google', icon: null, title: null };

  it('切替とログアウトの入口が両方ある', () => {
    const html = buildAccountMenuHtml(base);
    expect(html).toContain('switchAccount()');
    expect(html).toContain('logoutAccount()');
  });

  it('名前とアカウント種類を出す', () => {
    const html = buildAccountMenuHtml(base);
    expect(html).toContain('しょうしねい');
    expect(html).toContain('Googleアカウント');
  });

  it('アイコン・称号は設定されていれば出す', () => {
    const html = buildAccountMenuHtml({ ...base, icon: '🐉', title: '大富豪' });
    expect(html).toContain('🐉');
    expect(html).toContain('大富豪');
  });

  it('称号が無いときは称号の行を作らない', () => {
    expect(buildAccountMenuHtml(base)).not.toContain('acct-title');
  });

  it('ゲストには記録が残らないことを案内する', () => {
    const html = buildAccountMenuHtml({ ...base, name: '', kind: 'guest' });
    expect(html).toContain('ゲスト');
    expect(html).toContain('記録');
  });

  it('★表示名は自由入力なのでエスケープする★', () => {
    const html = buildAccountMenuHtml({ ...base, name: '<img onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('escapeHtml', () => {
  it('タグと引用符を無害化する', () => {
    expect(escapeHtml('<a href="x">&</a>'))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});
