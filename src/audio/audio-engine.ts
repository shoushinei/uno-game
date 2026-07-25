// ========================================
// 効果音の再生エンジン（Web Audio API）
//
// sound-spec.ts の数値定義を実際の音にする層。ここだけがブラウザAPIに
// 依存する（＝vitest からは読めない。ロジックは sound-spec.ts 側に置く）。
//
// 設計上の要点:
//  - AudioContext は「最初に鳴らそうとした時」に作る。無音のまま
//    ページを開いただけのユーザーにコンテキストを持たせない
//  - ブラウザは操作前の自動再生を禁止するため、最初のクリック／キー入力で
//    resume する。それまでは静かに何も鳴らさない（例外も出さない）
//  - ボット対戦は毎秒操作が飛んでくるので、短時間に音が積み上がらないよう
//    レート制限と同一音の重複除去を入れる
// ========================================
import { SOUND_SPECS, type SoundId, type SoundSpec, type ToneLayer } from './sound-spec.js';

/** 全体音量。個々のレイヤー音量はこれに乗算される */
const MASTER_GAIN = 0.42;

/** 同時に鳴らしすぎないための制限: WINDOW_MS 内に MAX_IN_WINDOW 音まで */
const WINDOW_MS = 130;
const MAX_IN_WINDOW = 4;

/** 同じ音がこのms以内に連続したら2つ目を捨てる（同期の重複発火よけ） */
const DEDUPE_MS = 45;

/** 1回の同期で複数の音が出るときのずらし幅(ms) */
const SEQUENCE_STAGGER_MS = 110;

/** 一度に鳴らす音の上限。演出キュー（QUEUE_MAX=4）と歩調を合わせる */
const SEQUENCE_MAX = 4;

const LS_OFF_KEY = 'pcgSoundOff';

// localStorage はブラウザ専用（vitest の node 環境には無い）ためガードする
function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch { /* 無視 */ }
}

// ----------------------------------------
// 設定（ON/OFF・localStorage記憶）
// ----------------------------------------

/** 効果音が有効か。既定はON（キーが無い＝まだ触っていない＝ON） */
export function isSoundOn(): boolean {
  return lsGet(LS_OFF_KEY) !== '1';
}

/** ON/OFF をトグルし、トグル後の状態（true=ON）を返す */
export function toggleSound(): boolean {
  const next = !isSoundOn();
  lsSet(LS_OFF_KEY, next ? '0' : '1');
  // ONにした瞬間だけ確認音を鳴らす（OFFにした直後に鳴ったら矛盾するため）
  if (next) playSound('ui-toggle');
  return next;
}

// ----------------------------------------
// AudioContext
// ----------------------------------------
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let ctxFailed = false;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  if (ctxFailed) return null;
  const AC: typeof AudioContext | undefined =
    typeof window !== 'undefined'
      ? (window.AudioContext ?? (window as any).webkitAudioContext)
      : undefined;
  if (!AC) { ctxFailed = true; return null; }
  try {
    ctx = new AC();
  } catch {
    ctxFailed = true;
    return null;
  }
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  return ctx;
}

/** 白色ノイズ1秒ぶん。打撃音・擦れ音の素材として使い回す */
function ensureNoise(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(c.sampleRate);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

/**
 * 最初のユーザー操作で AudioContext を resume する。
 * ブラウザの自動再生ポリシー対策で、app.ts から一度だけ呼ぶ。
 * 操作のたびに走るが、running なら何もしないので実質無コスト。
 */
export function initAudio(): void {
  if (typeof document === 'undefined') return;
  const unlock = (): void => {
    if (!isSoundOn()) return; // OFFのユーザーにはコンテキストを作らない
    const c = ensureCtx();
    if (c && c.state === 'suspended') void c.resume().catch(() => { /* 無視 */ });
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(ev, unlock, { passive: true });
  }
}

// ----------------------------------------
// 再生
// ----------------------------------------
let recentStarts: number[] = [];
const lastPlayedAt: Partial<Record<SoundId, number>> = {};

/** レート制限にかかっていないか（かかっていたら false＝鳴らさない） */
function allowedNow(id: SoundId, now: number): boolean {
  const prev = lastPlayedAt[id];
  if (prev !== undefined && now - prev < DEDUPE_MS) return false;
  recentStarts = recentStarts.filter(t => now - t < WINDOW_MS);
  if (recentStarts.length >= MAX_IN_WINDOW) return false;
  return true;
}

/** 1レイヤーぶんのノードを組んで発音予約する */
function scheduleLayer(c: AudioContext, out: GainNode, L: ToneLayer, t0: number, scale: number): void {
  const start = t0 + L.start;
  const stop = start + L.dur;

  // 音量エンベロープ: 短いアタック → 減衰。指数ランプは0を扱えないので下限を置く
  const env = c.createGain();
  const peak = Math.max(L.gain * scale, 0.0002);
  const attack = Math.min(L.attack ?? 0.006, L.dur * 0.5);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, stop);
  env.connect(out);

  if (L.wave === 'noise') {
    const src = c.createBufferSource();
    src.buffer = ensureNoise(c);
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = L.q ?? 1;
    bp.frequency.setValueAtTime(L.freq, start);
    if (L.freqTo) bp.frequency.exponentialRampToValueAtTime(L.freqTo, stop);
    src.connect(bp);
    bp.connect(env);
    // 毎回違う位置から読むことで、連打しても同じ質感の繰り返しに聞こえないようにする
    src.start(start, Math.random() * 0.5);
    src.stop(stop + 0.02);
  } else {
    const osc = c.createOscillator();
    osc.type = L.wave;
    osc.frequency.setValueAtTime(L.freq, start);
    if (L.freqTo) osc.frequency.exponentialRampToValueAtTime(L.freqTo, stop);
    osc.connect(env);
    osc.start(start);
    osc.stop(stop + 0.02);
  }
}

/**
 * 効果音を1つ鳴らす。
 * 音が出せない状況（OFF・未解錠・非対応ブラウザ）では静かに何もしない。
 * ゲーム進行に影響させないため、失敗しても例外を投げない。
 */
export function playSound(id: SoundId, gainScale = 1): void {
  if (!isSoundOn()) return;
  const spec: SoundSpec | undefined = SOUND_SPECS[id];
  if (!spec) return;

  const c = ensureCtx();
  // suspended（まだ操作していない）ときは鳴らさずに戻る。
  // ここで resume を試みると、操作起点でない再生としてブラウザに弾かれる
  if (!c || !master || c.state !== 'running') return;

  const now = Date.now();
  if (!allowedNow(id, now)) return;
  lastPlayedAt[id] = now;
  recentStarts.push(now);

  try {
    const t0 = c.currentTime + 0.005; // 直近すぎる予約はノイズになるので少し先へ
    const scale = spec.gain * gainScale;
    for (const layer of spec.layers) scheduleLayer(c, master, layer, t0, scale);
  } catch (e) {
    // 音の失敗でゲームを止めない
    console.error('効果音の再生でエラー:', id, e);
  }
}

/**
 * 複数の音を少しずつずらして鳴らす。
 * 1回の同期で複数の出来事が届いたとき（例: カードを出す→場が流れる→親交代）に
 * 同時発音で潰し合うのを避け、順番に聞こえるようにする。
 */
export function playSoundSequence(ids: Array<SoundId | null>): void {
  const list = ids.filter((x): x is SoundId => x !== null).slice(0, SEQUENCE_MAX);
  list.forEach((id, i) => {
    if (i === 0) playSound(id);
    else setTimeout(() => playSound(id), i * SEQUENCE_STAGGER_MS);
  });
}

/** テスト・ルーム切替用: レート制限の履歴をリセットする */
export function resetSoundThrottle(): void {
  recentStarts = [];
  for (const k of Object.keys(lastPlayedAt)) delete lastPlayedAt[k as SoundId];
}

// 呼び出し側が sound-spec を直接importしなくて済むよう型だけ再輸出する
export type { SoundId };
