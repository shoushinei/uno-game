// ========================================
// ★モバイルUI M2★ 5層レイアウト固有の描画
//
// 従来UI(#s-game)を 100dvh の5ゾーンに固定したことで生まれた、
// モバイル専用の表示要素をここでまとめて面倒を見る。
//
//   ③ 場   … フェルトの色＝現在のUNOの色 / 環の向き＝回転方向
//   ④ 手札 … いま操作できる行に赤帯を付ける
//   ⑤ 案内 … 何をすべきか＋手札の枚数を一行に集約する
//
// 設計原則は「言葉で説明せず、位置・色・マークで伝える」。
// 文字ラベル（「トランプの場」「現在の色：赤」「⟳ 時計回り」など）を
// 置かない代わりに、色と形で同じ情報を出すのがこのモジュールの役目。
//
// DOM に触らない判定部分は純粋関数として切り出してある（vitest対象）。
// ========================================

/** 場のフェルトに付けるクラス。色が未確定なら null（CSS既定の緑フェルト） */
export function feltColorClass(unoColor: string | null | undefined): string | null {
  switch (unoColor) {
    case 'red':    return 'c-red';
    case 'blue':   return 'c-blue';
    case 'green':  return 'c-green';
    case 'yellow': return 'c-yellow';
    default:       return null;
  }
}

const FELT_CLASSES = ['c-red', 'c-blue', 'c-green', 'c-yellow'];

export interface NoteInput {
  isMyTurn: boolean;
  iFinished: boolean;
  /** 'trump' | 'uno' */
  phase: string;
  trumpCount: number;
  unoCount: number;
  /** UNOの累積ペナルティ枚数（+2/+4の重ね） */
  penaltyAccum: number;
  /** 📢UNO宣言がまだ必要か */
  needsUnoCall: boolean;
  myRank: number | null;
}

/**
 * ⑤操作バーの上に出す案内の一行を組み立てる。
 *
 * 手札の行からラベルと枚数を削ったぶん、枚数はここに集約する。
 * 「トランプ」「UNO」という語は使わず 🃏 / 🎴 のマークで示す。
 * 自分の番でないときは空文字（CSSの :empty で行ごと消える）。
 */
export function buildNote(i: NoteInput): string {
  if (i.iFinished) {
    return i.myRank !== null ? `🏁 ${i.myRank}位で上がり — 観戦中` : '🏁 上がり — 観戦中';
  }
  if (!i.isMyTurn) return '';

  if (i.phase === 'trump') {
    if (i.trumpCount === 0) return 'トランプは出し切りました — 「UNOへ進む」を押してください';
    return `出したいトランプを選んでください（🃏 ${i.trumpCount}枚）`;
  }

  // UNOフェイズ
  if (i.unoCount === 0) return 'UNOは出し切りました — 「次へ進む」を押してください';
  if (i.penaltyAccum > 0) {
    return `⚠️ +${i.penaltyAccum} 累積中 — 同種で返すか、まとめて引く（🎴 ${i.unoCount}枚）`;
  }
  if (i.needsUnoCall) {
    return `出す前に 📢UNO! を押してください（🎴 ${i.unoCount}枚）`;
  }
  return `同じ色か同じ数字を1枚（🎴 ${i.unoCount}枚）`;
}

// ----------------------------------------
// DOM 反映
// ----------------------------------------

/** ③ 場: フェルトの色と、回転方向を表す環の向きを更新する */
export function renderMobileField(unoColor: string | null | undefined, dir: number): void {
  const field = document.getElementById('mg-field');
  if (field) {
    const cls = feltColorClass(unoColor);
    field.classList.remove(...FELT_CLASSES);
    if (cls) field.classList.add(cls);
  }
  const ring = document.getElementById('mg-ring');
  if (ring) {
    // dir===1 が時計回り（turn-order / PC UI と同じ約束）
    ring.classList.toggle('ccw', dir !== 1);
  }
}

/** ④ 手札: いま操作できる行にだけ赤帯を付ける */
export function renderMobileHands(canActTrump: boolean, canActUno: boolean): void {
  document.getElementById('mg-row-trump')?.classList.toggle('active', canActTrump);
  document.getElementById('mg-row-uno')?.classList.toggle('active', canActUno);
}

/** ⑤ 案内の一行 */
export function renderMobileNote(input: NoteInput): void {
  const el = document.getElementById('mg-note');
  if (!el) return;
  el.textContent = buildNote(input);
}
