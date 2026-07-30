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
  /** ★自動進行★ 手札0枚で自動的に次へ進む待ちか（ボタンを押させない） */
  autoAdvancing?: boolean;
}

/**
 * ⑤操作バーの上に出す案内の一行を組み立てる。
 *
 * 手札の行からラベルと枚数を削ったぶん、枚数はここに集約する。
 * 「トランプ」「UNO」という語は使わず 🃏 / 🎴 のマークで示す。
 *
 * ★必ず1行に収まる短さにすること★ この行は高さ20px固定で、
 * 折り返すと下部（操作エリア）の高さが変わってしまう。
 * ★自分の番でなくても空にしない★ 空にすると行が消えて高さが動くため、
 * 待っている間は手札の枚数だけを出しておく。
 * ボタンのラベルを短くした（「出す」「引く」「進む」）ぶん、
 * 何をする場面かはこの行が担う。
 */
export function buildNote(i: NoteInput): string {
  const counts = `🃏 ${i.trumpCount} ／ 🎴 ${i.unoCount}`;
  if (i.iFinished) {
    return i.myRank !== null ? `🏁 ${i.myRank}位で上がり — 観戦中` : '🏁 上がり — 観戦中';
  }
  if (!i.isMyTurn) return counts;

  // 自動で進む場面ではボタンを押させないので、案内も「待っていればよい」に変える
  if (i.autoAdvancing) return '出し切り — 自動で次へ進みます…';

  if (i.phase === 'trump') {
    if (i.trumpCount === 0) return '🃏 出し切り — 「進む」で次へ';
    return `🃏 ${i.trumpCount}枚 — 出すカードを選ぶ`;
  }

  // UNOフェイズ
  if (i.unoCount === 0) return '🎴 出し切り — 「進む」で次へ';
  if (i.penaltyAccum > 0) {
    return `⚠️ +${i.penaltyAccum} 累積中 — 同種で返すか引く`;
  }
  if (i.needsUnoCall) {
    return `📢 UNO! を押してから出す（🎴 ${i.unoCount}）`;
  }
  return `🎴 ${i.unoCount}枚 — 同じ色か同じ数字を1枚`;
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

// ----------------------------------------
// ★モバイルUI M3★ リアクションの検知
//
// 「新しく投げられたリアクション」を1回だけ拾う。1回だけを守るため
// 送り主ごとに既読の ts を持つ。
//
// ★自分が投げたぶんも返す★ ここが以前の穴だった。
// 送信者は②のチップ一覧に並ばない（自分は除外される）ので、自分が投げた
// リアクションは画面のどこにも出ていなかった。さらに送信時の中央ポップは
// ☰の全体リアクション（😂😭…）のボタンを探す実装で、対人リアクション
// （🍅💋💐）には対応するボタンが無く、こちらも空振りしていた。
// ＝「相手へ投げても自分の画面には何も起きない」状態だった。
// ----------------------------------------

export interface MobileReactionEvent {
  /** 送り主 */
  fromId: string;
  fromName: string;
  emoji: string;
  /** 対人リアクションの宛先。全体向け（自己リアクション）は null */
  targetId: string | null;
  /** 自分が宛先か（＝被弾トーストと着弾音を出す対象） */
  toMe: boolean;
}

let seenReactionTs: Record<string, number> | null = null;

/** テスト・ルーム切替用 */
export function resetHitToast(): void {
  seenReactionTs = null;
}

/**
 * 新しく投げられたリアクションを返す。
 * 初回同期では既読位置を記録するだけで何も返さない
 * （再接続時に過去分が一斉に出るのを防ぐ）。
 */
export function takeReactionEvents(
  reactions: Record<string, { emoji: string; ts: number; targetId?: string } | undefined>,
  myId: string,
  players: Array<{ id: string; name: string }>,
  now: number,
  isBlocked: (id: string) => boolean
): MobileReactionEvent[] {
  const first = seenReactionTs === null;
  if (first) seenReactionTs = {};
  const seen = seenReactionTs!;

  const out: MobileReactionEvent[] = [];
  for (const fromId of Object.keys(reactions)) {
    const r = reactions[fromId];
    if (!r || typeof r.ts !== 'number') continue;
    const prev = seen[fromId] ?? 0;
    if (r.ts <= prev) continue;
    seen[fromId] = r.ts;
    if (first) continue;                                  // 初回は既読化のみ
    if (now - r.ts >= 8000) continue;                     // 古すぎるものは出さない
    // ブロックは対人リアクションだけに効かせる（既存のバッジ表示と同じ規則）
    const targetId = r.targetId ?? null;
    if (targetId && isBlocked(fromId)) continue;
    out.push({
      fromId,
      fromName: players.find(p => p.id === fromId)?.name ?? '？',
      emoji: r.emoji,
      targetId,
      toMe: targetId === myId && fromId !== myId,
    });
  }
  return out;
}

/** 被弾トーストを画面中央付近に短く出す */
export function showHitToast(emoji: string, fromName: string): void {
  let el = document.getElementById('mg-hit-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mg-hit-toast';
    el.className = 'mg-hit-toast';
    document.getElementById('s-game')?.appendChild(el);
  }
  el.textContent = `${emoji} ${fromName} から！`;
  el.classList.remove('show');
  void el.offsetWidth; // リフローでアニメを頭から再生
  el.classList.add('show');
}
