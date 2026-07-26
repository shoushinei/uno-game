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

// ----------------------------------------
// ★モバイルUI M3★ 対人リアクションの被弾トースト
//
// 送り主のチップにはバッジが出るが、それだけでは「誰が自分に投げたか」が
// 分からない。宛先が自分のときだけ、名前を添えたトーストを1回出す。
// 「1回だけ」を守るため、宛先ごとに既読の ts を持つ。
// ----------------------------------------
let seenHitTs: Record<string, number> | null = null;

/** テスト・ルーム切替用 */
export function resetHitToast(): void {
  seenHitTs = null;
}

/**
 * 新しく自分宛てに飛んできたリアクションがあれば、その絵文字と送り主名を返す。
 * 無ければ null。初回同期では既読位置を記録するだけで何も返さない
 * （再接続時に過去分が一斉に出るのを防ぐ）。
 */
export function takeIncomingHit(
  reactions: Record<string, { emoji: string; ts: number; targetId?: string } | undefined>,
  myId: string,
  players: Array<{ id: string; name: string }>,
  now: number,
  isBlocked: (id: string) => boolean
): { emoji: string; fromName: string } | null {
  const first = seenHitTs === null;
  if (first) seenHitTs = {};
  const seen = seenHitTs!;

  let hit: { emoji: string; fromName: string } | null = null;
  for (const fromId of Object.keys(reactions)) {
    const r = reactions[fromId];
    if (!r || typeof r.ts !== 'number') continue;
    const prev = seen[fromId] ?? 0;
    if (r.ts <= prev) continue;
    seen[fromId] = r.ts;
    if (first) continue;                       // 初回は既読化のみ
    if (r.targetId !== myId || fromId === myId) continue;
    if (now - r.ts >= 8000) continue;          // 古すぎるものは出さない
    if (isBlocked(fromId)) continue;
    hit = { emoji: r.emoji, fromName: players.find(p => p.id === fromId)?.name ?? '？' };
  }
  return hit;
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
