// ========================================
// 効果音の定義（純粋・Web Audio非依存・テスト対象）
//
// 音声ファイルは一切持たず、「どんな波形を重ねるか」を数値テーブルで
// 表現する。実際に鳴らすのは audio-engine.ts の役目で、このファイルは
// 仕様の定義と「どの出来事にどの音を当てるか」の対応だけを持つ。
//
// この分離のおかげで:
//   - 音の定義は vitest でテストできる（AudioContext が無くても検証可能）
//   - 将来ここを音声ファイル参照に差し替えても、呼び出し側は変わらない
// ========================================
import type { EffectDescriptor } from '../ui/pc/effects/effect-derive.js';

// ---- 音の種類 ----
export type SoundId =
  // 通常プレイ
  | 'trump-play' | 'uno-play' | 'draw' | 'pass' | 'say-uno'
  | 'field-clear' | 'parent-color' | 'reverse'
  // トランプの特殊効果
  | 'cut' | 'revolution' | 'suit-lock' | 'eleven-back' | 'joker' | 'spade-three'
  // 節目
  | 'finish' | 'game-start' | 'my-turn'
  // リアクション
  | 'reaction' | 'hit'
  // ヨット対決
  | 'dice-roll' | 'duel-start' | 'duel-win' | 'duel-lose' | 'duel-draw'
  // 持ち時間・UI
  | 'timer-warn' | 'timer-tick' | 'ui-toggle';

/**
 * 音を構成する1レイヤー。
 * これを複数重ねて1つの効果音を作る（和音・アルペジオ・打撃音＋余韻など）。
 */
export interface ToneLayer {
  /** 波形。'noise' は白色ノイズをバンドパスに通す（打撃音・擦れ音用） */
  wave: 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise';
  /** 開始周波数(Hz)。noise ではバンドパスの中心周波数 */
  freq: number;
  /** 終了周波数(Hz)。指定するとこの値へ指数的にスイープする */
  freqTo?: number;
  /** 音の開始オフセット(秒)。ずらすとアルペジオ・連打になる */
  start: number;
  /** 長さ(秒) */
  dur: number;
  /** このレイヤーの音量(0〜1) */
  gain: number;
  /** 立ち上がり(秒)。省略時 0.006（打撃的） */
  attack?: number;
  /** noise のバンドパスQ。大きいほど細く金属的 */
  q?: number;
}

export interface SoundSpec {
  layers: ToneLayer[];
  /** この音全体のスケール（レイヤー音量に乗算） */
  gain: number;
}

// 音名 → 周波数（読みやすさのため）
const C4 = 261.63, D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392.00, A4 = 440.00, B4 = 493.88;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.00;
const C6 = 1046.50, D6 = 1174.66, G6 = 1567.98, A6 = 1760.00, C7 = 2093.00;

// ----------------------------------------
// 音色テーブル
//
// 方針: 1音は基本 0.05〜0.6秒。ボット対戦では毎秒操作が飛んでくるので
// 「短く・角が立ちすぎず・重なっても濁らない」ことを優先する。
// 節目（上がり・ゲーム開始・対決の決着）だけは長めに鳴らしてよい。
// ----------------------------------------
export const SOUND_SPECS: Record<SoundId, SoundSpec> = {
  // --- カードを場に置く: ノイズの打撃＋低い胴鳴り ---
  'trump-play': {
    gain: 1,
    layers: [
      { wave: 'noise',    freq: 1800, freqTo: 700, start: 0, dur: 0.075, gain: 0.50, q: 0.9 },
      { wave: 'triangle', freq: 220,  freqTo: 130, start: 0, dur: 0.080, gain: 0.25 },
    ],
  },
  // UNOはトランプより一段軽く高く鳴らし、耳で「どっちを出したか」が分かるようにする
  'uno-play': {
    gain: 1,
    layers: [
      { wave: 'noise',    freq: 2600, freqTo: 1100, start: 0, dur: 0.065, gain: 0.45, q: 0.9 },
      { wave: 'triangle', freq: 330,  freqTo: 200,  start: 0, dur: 0.070, gain: 0.22 },
    ],
  },
  // --- 山札から引き抜く擦れ音（上向きスイープ） ---
  // ノイズ単体＋バンドパスは実測で音圧が落ちるため、gainは他より大きめに取る
  draw: {
    gain: 1,
    layers: [
      { wave: 'noise', freq: 900, freqTo: 3800, start: 0, dur: 0.13, gain: 0.75, q: 0.7, attack: 0.03 },
    ],
  },
  // --- パス: 小さく下がる2度。出来事としては軽いので控えめ ---
  pass: {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: G4, freqTo: D4, start: 0, dur: 0.14, gain: 0.22 },
    ],
  },
  // --- 📢UNO宣言: 明るい上昇アルペジオ ---
  'say-uno': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: C5, start: 0.00, dur: 0.10, gain: 0.30 },
      { wave: 'triangle', freq: E5, start: 0.07, dur: 0.10, gain: 0.30 },
      { wave: 'triangle', freq: G5, start: 0.14, dur: 0.20, gain: 0.34 },
      { wave: 'sine',     freq: G6, start: 0.14, dur: 0.18, gain: 0.10 },
    ],
  },
  // --- 場が流れる: 高→低へ掃き払う ---
  'field-clear': {
    gain: 1,
    layers: [
      { wave: 'noise',    freq: 4200, freqTo: 500, start: 0, dur: 0.34, gain: 0.34, q: 0.6, attack: 0.02 },
      { wave: 'triangle', freq: 300,  freqTo: 150, start: 0, dur: 0.30, gain: 0.16 },
    ],
  },
  // --- 👑親の権限: キラッとした上昇 ---
  'parent-color': {
    gain: 1,
    layers: [
      { wave: 'sine', freq: G5, start: 0.00, dur: 0.10, gain: 0.26 },
      { wave: 'sine', freq: C6, start: 0.08, dur: 0.22, gain: 0.26 },
      { wave: 'sine', freq: G6, start: 0.14, dur: 0.20, gain: 0.10 },
    ],
  },
  // --- リバース: 上がって下がる（向きが返る形をそのまま音にする） ---
  reverse: {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: E4, freqTo: F5, start: 0.00, dur: 0.16, gain: 0.26 },
      { wave: 'triangle', freq: F5, freqTo: E4, start: 0.16, dur: 0.20, gain: 0.26 },
    ],
  },

  // --- ✂️8切り: 鋭く短い一閃 ---
  cut: {
    gain: 1,
    layers: [
      { wave: 'noise',  freq: 5200, freqTo: 2200, start: 0, dur: 0.07, gain: 0.50, q: 3 },
      { wave: 'square', freq: A5,   freqTo: E4,   start: 0, dur: 0.09, gain: 0.20 },
    ],
  },
  // --- 🌀革命: 全部ひっくり返る低いスイープ。いちばん派手に鳴らす ---
  revolution: {
    gain: 1,
    layers: [
      { wave: 'sawtooth', freq: F5,   freqTo: 110, start: 0, dur: 0.55, gain: 0.26, attack: 0.02 },
      { wave: 'sine',     freq: 180,  freqTo: 60,  start: 0, dur: 0.60, gain: 0.30 },
      { wave: 'noise',    freq: 3000, freqTo: 300, start: 0, dur: 0.50, gain: 0.16, q: 0.5 },
    ],
  },
  // --- ⛓しばり: 金属を2回打つ ---
  'suit-lock': {
    gain: 1,
    layers: [
      { wave: 'square', freq: 300,  start: 0.00, dur: 0.06, gain: 0.20 },
      { wave: 'noise',  freq: 2400, start: 0.00, dur: 0.07, gain: 0.30, q: 6 },
      { wave: 'square', freq: 300,  start: 0.11, dur: 0.06, gain: 0.20 },
      { wave: 'noise',  freq: 2400, start: 0.11, dur: 0.08, gain: 0.30, q: 6 },
    ],
  },
  // --- 🔄Jバック: 下がって戻る（一時的な逆転を表す） ---
  'eleven-back': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: E5, freqTo: A4, start: 0.00, dur: 0.12, gain: 0.26 },
      { wave: 'triangle', freq: A4, freqTo: E5, start: 0.12, dur: 0.18, gain: 0.26 },
    ],
  },
  // --- 🃏ジョーカー: いたずらっぽい矩形波の駆け上がり ---
  joker: {
    gain: 1,
    layers: [
      { wave: 'square', freq: C5, start: 0.00, dur: 0.07, gain: 0.16 },
      { wave: 'square', freq: F5, start: 0.06, dur: 0.07, gain: 0.16 },
      { wave: 'square', freq: A5, start: 0.12, dur: 0.07, gain: 0.16 },
      { wave: 'square', freq: D6, start: 0.18, dur: 0.22, gain: 0.18 },
      { wave: 'sine',   freq: C7, start: 0.18, dur: 0.20, gain: 0.07 },
    ],
  },
  // --- ♠3ジョーカー返し: ジョーカーの逆再生（駆け下がり） ---
  'spade-three': {
    gain: 1,
    layers: [
      { wave: 'square', freq: D6, start: 0.00, dur: 0.07, gain: 0.16 },
      { wave: 'square', freq: A5, start: 0.06, dur: 0.07, gain: 0.16 },
      { wave: 'square', freq: D5, start: 0.12, dur: 0.24, gain: 0.20 },
    ],
  },

  // --- 🏁上がり: 4音のファンファーレ ---
  finish: {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: C5, start: 0.00, dur: 0.11, gain: 0.30 },
      { wave: 'triangle', freq: E5, start: 0.10, dur: 0.11, gain: 0.30 },
      { wave: 'triangle', freq: G5, start: 0.20, dur: 0.13, gain: 0.30 },
      { wave: 'triangle', freq: C6, start: 0.32, dur: 0.42, gain: 0.34 },
      { wave: 'sine',     freq: G6, start: 0.32, dur: 0.40, gain: 0.10 },
      { wave: 'sine',     freq: C7, start: 0.36, dur: 0.34, gain: 0.06 },
    ],
  },
  // --- 🎮ゲーム開始: ゆっくり立ち上げてから開幕の和音 ---
  'game-start': {
    gain: 1,
    layers: [
      { wave: 'sine',     freq: C4, start: 0.00, dur: 0.14, gain: 0.22 },
      { wave: 'sine',     freq: G4, start: 0.13, dur: 0.14, gain: 0.24 },
      { wave: 'sine',     freq: C5, start: 0.26, dur: 0.16, gain: 0.26 },
      { wave: 'triangle', freq: G5, start: 0.42, dur: 0.50, gain: 0.28 },
      { wave: 'sine',     freq: C6, start: 0.42, dur: 0.46, gain: 0.12 },
    ],
  },
  // --- ▶あなたのターン: 「自分の番に気づかない」対策。はっきり2音 ---
  'my-turn': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: D5, start: 0.00, dur: 0.13, gain: 0.34 },
      { wave: 'triangle', freq: A5, start: 0.12, dur: 0.30, gain: 0.36 },
      { wave: 'sine',     freq: A6, start: 0.12, dur: 0.26, gain: 0.09 },
    ],
  },

  // --- リアクション発生（軽いポップ） ---
  reaction: {
    gain: 1,
    layers: [
      { wave: 'sine', freq: 700, freqTo: 1300, start: 0, dur: 0.09, gain: 0.22 },
    ],
  },
  // --- 自分が投げられた側（鈍い着弾） ---
  hit: {
    gain: 1,
    layers: [
      { wave: 'noise', freq: 900, freqTo: 220, start: 0, dur: 0.16, gain: 0.42, q: 0.8 },
      { wave: 'sine',  freq: 200, freqTo: 90,  start: 0, dur: 0.18, gain: 0.30 },
    ],
  },

  // --- 🎲サイコロ: 短いノイズを間隔を広げながら5回＝転がって止まる ---
  // 音は staggered なので peak は1粒ぶんしか出ない。細いバンドパス(高Q)は
  // 実測で大きく音圧を失ったため、Qを広げて「カチッ」と粒立つ帯域にしてある
  'dice-roll': {
    gain: 1,
    layers: [
      { wave: 'noise',    freq: 1500, start: 0.00, dur: 0.04, gain: 0.70, q: 1.2 },
      { wave: 'noise',    freq: 2100, start: 0.055, dur: 0.04, gain: 0.62, q: 1.2 },
      { wave: 'noise',    freq: 1300, start: 0.10, dur: 0.04, gain: 0.66, q: 1.2 },
      { wave: 'noise',    freq: 1900, start: 0.15, dur: 0.05, gain: 0.58, q: 1.2 },
      { wave: 'noise',    freq: 1100, start: 0.21, dur: 0.06, gain: 0.54, q: 1.0 },
      { wave: 'triangle', freq: 160, freqTo: 110, start: 0.21, dur: 0.10, gain: 0.14 },
    ],
  },
  // --- ⚔対決開始: 低→高の緊張感 ---
  'duel-start': {
    gain: 1,
    layers: [
      { wave: 'sawtooth', freq: 110, freqTo: 220, start: 0.00, dur: 0.40, gain: 0.20, attack: 0.05 },
      { wave: 'square',   freq: E4,  start: 0.30, dur: 0.10, gain: 0.18 },
      { wave: 'square',   freq: A4,  start: 0.42, dur: 0.30, gain: 0.20 },
    ],
  },
  'duel-win': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: E5, start: 0.00, dur: 0.10, gain: 0.30 },
      { wave: 'triangle', freq: A5, start: 0.10, dur: 0.12, gain: 0.30 },
      { wave: 'triangle', freq: D6, start: 0.22, dur: 0.40, gain: 0.34 },
      { wave: 'sine',     freq: A6, start: 0.22, dur: 0.36, gain: 0.10 },
    ],
  },
  'duel-lose': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: A4, start: 0.00, dur: 0.13, gain: 0.26 },
      { wave: 'triangle', freq: F4, start: 0.13, dur: 0.14, gain: 0.26 },
      { wave: 'triangle', freq: C4, start: 0.27, dur: 0.40, gain: 0.28 },
      { wave: 'sine',     freq: 130.81, start: 0.27, dur: 0.40, gain: 0.14 },
    ],
  },
  'duel-draw': {
    gain: 1,
    layers: [
      { wave: 'triangle', freq: A4, start: 0.00, dur: 0.12, gain: 0.24 },
      { wave: 'triangle', freq: A4, start: 0.16, dur: 0.26, gain: 0.22 },
    ],
  },

  // --- 残り10秒の警告（2連ビープ） ---
  'timer-warn': {
    gain: 1,
    layers: [
      { wave: 'sine', freq: A5, start: 0.00, dur: 0.09, gain: 0.24 },
      { wave: 'sine', freq: A5, start: 0.14, dur: 0.12, gain: 0.24 },
    ],
  },
  // --- 残り5秒以下の秒針（毎秒鳴るので極力短く小さく） ---
  'timer-tick': {
    gain: 1,
    layers: [
      { wave: 'sine', freq: C6, start: 0, dur: 0.05, gain: 0.18 },
    ],
  },
  // --- 設定ONの確認音 ---
  'ui-toggle': {
    gain: 1,
    layers: [
      { wave: 'sine', freq: B4, start: 0.00, dur: 0.05, gain: 0.20 },
      { wave: 'sine', freq: D6, start: 0.05, dur: 0.10, gain: 0.20 },
    ],
  },
};

/** その音が鳴り終わるまでの長さ(秒)。エンジンのノード停止時刻の算出に使う */
export function specDuration(spec: SoundSpec): number {
  let end = 0;
  for (const l of spec.layers) {
    const e = l.start + l.dur;
    if (e > end) end = e;
  }
  return end;
}

// ----------------------------------------
// 出来事 → 音 の対応
// ----------------------------------------

/**
 * トランプの特殊効果は同時に複数立つ（例: 8切り＋しばり）。
 * 全部鳴らすと濁るので「いちばん盛り上がる1つ」だけを選ぶ。
 * 配列の並びがそのまま優先順位。
 */
const SPECIAL_PRIORITY: Array<[string, SoundId]> = [
  ['revolution',  'revolution'],
  ['jokerSingle', 'joker'],
  ['spadeThree',  'spade-three'],
  ['eightCut',    'cut'],
  ['elevenBack',  'eleven-back'],
  ['suitLock',    'suit-lock'],
];

export function soundForSpecial(types: string[]): SoundId | null {
  for (const [type, id] of SPECIAL_PRIORITY) {
    if (types.includes(type)) return id;
  }
  return null;
}

/**
 * 演出ディスクリプタから鳴らす音を決める。
 * 演出（effect-derive）が既に「誰が何をしたか」を全部導出しているので、
 * ここは対応表を書くだけで済む＝検知ロジックを二重に持たない。
 */
export function soundForEffect(desc: EffectDescriptor): SoundId | null {
  switch (desc.kind) {
    case 'game-start':    return 'game-start';
    case 'trump-play':    return 'trump-play';
    case 'uno-play':      return 'uno-play';
    case 'draw':          return 'draw';
    case 'pass':          return 'pass';
    case 'say-uno':       return 'say-uno';
    case 'parent-color':  return 'parent-color';
    case 'field-clear':   return 'field-clear';
    case 'reverse':       return 'reverse';
    case 'finish':        return 'finish';
    case 'trump-special': return soundForSpecial(desc.types);
    default:              return null;
  }
}
