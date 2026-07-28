// ========================================
// 触覚フィードバック（バイブレーション）
//
// 効果音（sound-spec.ts + audio-engine.ts）の触覚版。音を出せない場面
// （マナーモード・電車の中）でも「自分の番が来た」「操作が通った」が
// 分かるようにする。
//
// ★対応状況★
//   Android(Chrome) … navigator.vibrate が普通に使える
//   iOS(Safari/PWA) … WebKit が触覚APIを公開していないため何も起きない
// 未対応環境では vibrate() が黙って何もしないだけなので、呼び出し側は
// 分岐を書かなくてよい。将来 iOS が対応すれば自動的に効き始める。
//
// sound-spec/audio-engine のようにファイルを割っていないのは、ここには
// AudioContext のような「vitest から読めない依存」が無いため。パターン表と
// hapticForEffect は純粋なのでそのままテストできる。
// ========================================
import type { EffectDescriptor } from '../ui/pc/effects/effect-derive.js';

export type HapticId =
  | 'tap'        // 自分がカードを出した／引いた
  | 'double'     // 📢UNO宣言など、少し強調したい自分の操作
  | 'my-turn'    // ★自分の番が来た（いちばん重要）
  | 'strong'     // 自分に何か飛んできた（リアクションの被弾など）
  | 'penalty'    // 自分がペナルティを受けた（対決に負けて+4枚など）
  | 'finish';    // 自分が上がった

/**
 * 振動パターン(ms)。数値1つなら「その長さ1回」、配列なら
 * [振動, 停止, 振動, ...] の交互。
 *
 * 方針: 音より控えめに。ボット戦は毎秒操作が飛んでくるので、
 * 長く振動させると持っているだけで不快になる。節目だけ強くする。
 */
export const HAPTIC_PATTERNS: Record<HapticId, number | number[]> = {
  tap:       12,
  double:    [10, 40, 10],
  'my-turn': [45, 90, 45],
  strong:    35,
  penalty:   [60, 50, 60],
  finish:    [30, 60, 30, 60, 90],
};

/**
 * 演出ディスクリプタ → 振動。
 *
 * ★自分に関係する出来事だけ振動させる★
 * 最大8人＋ボットが動くので、他人の操作でも振動させると鳴りっぱなしに
 * なって「自分の番」の合図が埋もれる。合図としての価値を守るため、
 * 他人の操作では意図的に振動させない。
 */
export function hapticForEffect(desc: EffectDescriptor, myId: string | null): HapticId | null {
  if (!myId) return null;
  switch (desc.kind) {
    case 'trump-play':
    case 'uno-play':
    case 'draw':
      return desc.playerId === myId ? 'tap' : null;
    case 'say-uno':
      return desc.playerId === myId ? 'double' : null;
    case 'trump-special':
      // 8切り・革命など。自分が起こしたときだけ手応えを返す
      return desc.playerId === myId ? 'strong' : null;
    case 'finish':
      return desc.playerId === myId ? 'finish' : null;
    default:
      return null;
  }
}

// ----------------------------------------
// 設定（ON/OFF・localStorage記憶）— audio-engine と同じ作法
// ----------------------------------------
const LS_OFF_KEY = 'pcgHapticOff';

function lsGet(key: string): string | null {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, value: string): void {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); } catch { /* 無視 */ }
}

/** この端末で振動できるか（＝設定ボタンを出す価値があるか） */
export function isHapticSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** 振動が有効か。既定はON（キーが無い＝まだ触っていない＝ON） */
export function isHapticOn(): boolean {
  return lsGet(LS_OFF_KEY) !== '1';
}

/** ON/OFF をトグルし、トグル後の状態（true=ON）を返す */
export function toggleHaptic(): boolean {
  const next = !isHapticOn();
  lsSet(LS_OFF_KEY, next ? '0' : '1');
  // ONにした瞬間だけ手応えを返す（OFFにした直後に震えたら矛盾するため）
  if (next) vibrate('tap');
  return next;
}

// ----------------------------------------
// 実行
// ----------------------------------------

/** 連続発火の間引き。これより短い間隔の振動は捨てる */
const MIN_INTERVAL_MS = 70;
let lastAt = 0;

/**
 * 振動させる。未対応環境・OFF設定・裏画面では何もしない。
 * 失敗しても例外は投げない（ゲーム進行を止めないため）。
 */
export function vibrate(id: HapticId): void {
  if (!isHapticSupported() || !isHapticOn()) return;
  // 裏に回っている間は振動させない（ブラウザ側でも弾かれるが、意図を明示する）
  if (typeof document !== 'undefined' && document.hidden) return;

  const now = Date.now();
  if (now - lastAt < MIN_INTERVAL_MS) return;
  lastAt = now;

  try { navigator.vibrate(HAPTIC_PATTERNS[id]); } catch { /* 無視 */ }
}

/** 間引きの状態を戻す（テスト用） */
export function resetHapticThrottle(): void {
  lastAt = 0;
}
