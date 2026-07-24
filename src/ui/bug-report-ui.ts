// ========================================
// バグ報告モーダル（🐛）の開閉・送信
//
// 入口は3か所（従来UIゲームヘッダー / PC UIドロワーのフッター / リザルト画面）。
// どこから開いても同じモーダル #bug-report-modal を使う。
// 送信の実体は src/bug-report.ts（Firestore bugReports へ作成のみ）。
// ========================================
import { submitBugReport } from '../bug-report.js';

declare global {
  interface Window {
    openBugReport: () => void;
    closeBugReport: (event?: Event) => void;
    sendBugReport: () => Promise<void>;
  }
}

let sending = false;

function setMsg(text: string, isErr: boolean): void {
  const el = document.getElementById('bug-report-msg');
  if (el) { el.textContent = text; el.className = 'msg' + (isErr ? ' err' : ' ok'); }
}

window.openBugReport = () => {
  const modal = document.getElementById('bug-report-modal');
  if (!modal) return;
  setMsg('', false);
  modal.style.display = 'flex';
  const ta = document.getElementById('bug-report-text') as HTMLTextAreaElement | null;
  ta?.focus();
};

window.closeBugReport = () => {
  const modal = document.getElementById('bug-report-modal');
  if (modal) modal.style.display = 'none';
};

window.sendBugReport = async () => {
  if (sending) return;
  const ta = document.getElementById('bug-report-text') as HTMLTextAreaElement | null;
  const btn = document.getElementById('bug-report-send') as HTMLButtonElement | null;
  const text = ta?.value ?? '';
  if (!text.trim()) { setMsg('内容を入力してください', true); return; }

  sending = true;
  if (btn) btn.disabled = true;
  setMsg('送信中...', false);
  try {
    const r = await submitBugReport(text);
    if (r.ok) {
      setMsg('✅ 報告を送りました。ありがとうございます！', false);
      if (ta) ta.value = '';
      setTimeout(() => window.closeBugReport(), 1500);
    } else if (r.reason === 'cooldown') {
      setMsg('連続で送信できません。少し待ってからもう一度お願いします', true);
    } else if (r.reason === 'empty') {
      setMsg('内容を入力してください', true);
    } else {
      setMsg('送信に失敗しました。通信状態を確認してください', true);
    }
  } finally {
    sending = false;
    if (btn) btn.disabled = false;
  }
};
