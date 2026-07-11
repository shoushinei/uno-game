// ========================================
// リプレイ画面のコントローラー
//
// index.html の onclick="..." から呼ばれる window.* 関数をここで登録する。
// 既存の app.js が game-actions.js の関数を window.* に橋渡ししているのと
// 同じ役割を、リプレイ画面（replay-engine.ts / replay-render.ts）に対して行う。
// ========================================
import { ReplayEngine } from './engine';
import { renderReplayView } from './render';
import type { ReplayFile } from './types';

// window オブジェクトに生やす関数の型宣言
// （これを書かないと TypeScript の strict モードでエラーになる）
declare global {
  interface Window {
    loadReplayFile: (event: Event) => void;
    replayStepForward: () => void;
    replayStepBack: () => void;
    replaySeek: (value: string) => void;
    replaySetSpeed: (value: string) => void;
    replayTogglePlay: () => void;
  }
}

let engine: ReplayEngine | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let playIntervalMs = 1000;

function setStatus(text: string): void {
  const elm = document.getElementById('replay-status');
  if (elm) elm.textContent = text;
}

/** 自動再生を止める（ボタンの見た目も元に戻す） */
function stopPlaying(): void {
  if (playTimer) { clearInterval(playTimer); playTimer = null; }
  const btn = document.getElementById('replay-play-btn');
  if (btn) btn.textContent = '▶ 再生';
}

/** 現在のエンジンの状態を画面に反映する（描画＋進捗バー＋ステータス文言） */
function refresh(): void {
  if (!engine) return;
  renderReplayView(engine);
  const scrubber = document.getElementById('replay-scrubber') as HTMLInputElement | null;
  if (scrubber) scrubber.value = String(engine.currentIndex);
  const progress = document.getElementById('replay-progress');
  if (progress) progress.textContent = `${engine.currentIndex} / ${engine.totalSteps} 手`;
  setStatus(engine.currentIndex === 0 ? '再生開始前' : `${engine.currentIndex}手目まで再生済み`);
  if (engine.currentIndex >= engine.totalSteps) stopPlaying();
}

// ----------------------------------------
// ファイル読み込み
// ----------------------------------------
window.loadReplayFile = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text) as ReplayFile;
    if (data.version !== 1 || !data.initialState || !Array.isArray(data.actionLog)) {
      setStatus('⚠️ リプレイファイルの形式が正しくありません');
      return;
    }
    stopPlaying();
    engine = new ReplayEngine(data);
    const controls = document.getElementById('replay-controls');
    if (controls) controls.style.display = 'block';
    const scrubber = document.getElementById('replay-scrubber') as HTMLInputElement | null;
    if (scrubber) scrubber.max = String(engine.totalSteps);
    refresh();
  } catch (e) {
    setStatus('⚠️ 読み込みに失敗しました: ' + (e as Error).message);
  }
};

// ----------------------------------------
// 再生コントロール
// ----------------------------------------
window.replayStepForward = () => {
  if (!engine) return;
  stopPlaying();
  engine.stepForward();
  refresh();
};

window.replayStepBack = () => {
  if (!engine) return;
  stopPlaying();
  engine.stepBackward();
  refresh();
};

window.replaySeek = (value: string) => {
  if (!engine) return;
  stopPlaying();
  engine.goTo(Number(value));
  refresh();
};

window.replaySetSpeed = (value: string) => {
  playIntervalMs = Number(value);
  if (playTimer) {
    // 再生中に速度が変更された場合は、いったん止めて新しい速度で再開する
    stopPlaying();
    window.replayTogglePlay();
  }
};

window.replayTogglePlay = () => {
  if (!engine) return;
  const btn = document.getElementById('replay-play-btn');
  if (playTimer) { stopPlaying(); return; }
  if (btn) btn.textContent = '⏸ 一時停止';
  playTimer = setInterval(() => {
    if (!engine || !engine.stepForward()) { stopPlaying(); return; }
    refresh();
  }, playIntervalMs);
};
