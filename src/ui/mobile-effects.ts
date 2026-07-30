// ========================================
// ★モバイルUI★ 盤面の演出
//
// PC UIの演出（src/ui/pc/effects/）は席の座標(.pcg-seat)や専用レイヤーに
// 強く紐づいているため、そのままは使えない。ただし「何が起きたか」を
// 導出する部分（effect-derive.ts）は純粋でUI非依存なので、そちらは共有し、
// ここでは「モバイルのDOMのどこからどこへ動かすか」だけを実装する。
//
// 方針は視認性優先:
//  - カードは「誰が出したか」が分かるよう、その人のチップから場へ飛ばす
//  - 自分の操作は手札エリアから飛ばす（自分の行動だと分かる）
//  - UNOの色が変わったら、場の色が変わっただけでは気づきにくいので
//    新しい色の波紋を広げて知らせる
//  - 特殊効果（8切り・革命など）は既存の全画面演出(#trump-effect)が
//    担当しているので、ここでは二重に出さない
// ========================================
import type { EffectDescriptor } from './pc/effects/effect-derive.js';
import type { Player } from '../logic/types';

interface Point { x: number; y: number }

/** 1演出あたりの長さ(ms)。モバイルは操作テンポを邪魔しない短さに寄せる */
const DUR = {
  fly: 300,
  flyStagger: 45,
  draw: 240,
  bubble: 750,
  sweep: 450,
  colorRipple: 700,
  reactFly: 620,
  reactHit: 380,
};

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function layer(): HTMLElement | null {
  return document.getElementById('mg-fx');
}

/** 要素の中心を、演出レイヤー内の座標に変換する */
function centerOf(el: Element | null): Point | null {
  const l = layer();
  if (!el || !l) return null;
  const r = el.getBoundingClientRect();
  const lr = l.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2 - lr.left, y: r.top + r.height / 2 - lr.top };
}

function fallbackCenter(): Point {
  const l = layer();
  if (!l) return { x: 0, y: 0 };
  const r = l.getBoundingClientRect();
  return { x: r.width / 2, y: r.height / 2 };
}

// ---- モバイルの各アンカー ----
function anchorPlayer(playerId: string, myId: string): Point {
  // 自分は②に並ばない（他プレイヤーだけ）ので、自分の操作は手札エリアを起点にする
  if (playerId === myId) {
    return centerOf(document.getElementById('mg-row-trump')) ?? fallbackCenter();
  }
  return centerOf(document.querySelector(`.op[data-player-id="${playerId}"]`))
    ?? centerOf(document.getElementById('opl'))
    ?? fallbackCenter();
}
function anchorTrumpField(): Point {
  return centerOf(document.getElementById('trump-field')) ?? fallbackCenter();
}
function anchorUnoField(): Point {
  return centerOf(document.getElementById('uno-field')) ?? fallbackCenter();
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** レイヤーへ一時要素を追加する（durationMs 後に自動削除） */
function spawn(html: string, p: Point, cls: string, durationMs: number): HTMLElement | null {
  const l = layer();
  if (!l) return null;
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  l.appendChild(el);
  setTimeout(() => el.remove(), durationMs + 150);
  return el;
}

/** from → to へ飛ばす */
function fly(html: string, from: Point, to: Point, delayMs: number, cls = 'mg-fx-card'): void {
  const el = spawn(html, from, `mg-fx-fly ${cls}`, DUR.fly + delayMs);
  if (!el) return;
  const rot = (Math.random() - 0.5) * 26;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1 },
      {
        transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.9) rotate(${rot}deg)`,
        opacity: 0.92,
      },
    ],
    { duration: DUR.fly, delay: delayMs, easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)', fill: 'forwards' }
  );
}

/** その人の上に短い吹き出しを出す */
function bubble(p: Point, text: string, cls = ''): void {
  const el = spawn(text, { x: p.x, y: p.y - 22 }, `mg-fx-bubble ${cls}`, DUR.bubble);
  if (!el) return;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -70%) scale(1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -100%) scale(0.95)', opacity: 0 },
    ],
    { duration: DUR.bubble, easing: 'ease-out', fill: 'forwards' }
  );
}

// ---- カードのHTML（盤面と同じ見た目の小型版） ----
const TRUMP_RED = new Set(['♥', '♦']);
function trumpCardHtml(c: { s: string; v: string }): string {
  const red = TRUMP_RED.has(c.s) ? ' red' : '';
  return `<div class="mg-fx-tcard${red}"><span>${c.s}</span><b>${c.v}</b></div>`;
}
const UNO_CLASS: Record<string, string> = { r: 'r', b: 'b', g: 'g', y: 'y', w: 'w' };
function unoCardHtml(c: { c: string; v: string } | null): string {
  if (!c) return '<div class="mg-fx-ucard back"></div>';
  return `<div class="mg-fx-ucard ${UNO_CLASS[c.c] ?? 'w'}">${c.v}</div>`;
}

// ----------------------------------------
// 各演出
// ----------------------------------------
function playTrumpPlay(d: Extract<EffectDescriptor, { kind: 'trump-play' }>, myId: string): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = anchorPlayer(d.playerId, myId);
  const to = anchorTrumpField();
  const cards = d.cards.slice(0, 4); // 革命の大量出しでも4枚まで
  cards.forEach((c, i) => fly(trumpCardHtml(c), from, to, i * DUR.flyStagger));
  return sleep(DUR.fly + cards.length * DUR.flyStagger);
}

function playUnoPlay(d: Extract<EffectDescriptor, { kind: 'uno-play' }>, myId: string): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = anchorPlayer(d.playerId, myId);
  const to = anchorUnoField();
  fly(unoCardHtml(d.card as any), from, to, 0);
  return sleep(DUR.fly);
}

function playDraw(d: Extract<EffectDescriptor, { kind: 'draw' }>, myId: string): Promise<void> {
  const to = anchorPlayer(d.playerId, myId);
  if (!reducedMotion()) {
    const from = anchorUnoField();
    const n = Math.min(d.count, 4);
    for (let i = 0; i < n; i++) fly('<div class="mg-fx-ucard back"></div>', from, to, i * 60);
  }
  // 枚数は「何枚引かされたか」が要点なので、2枚以上は数字で明示する
  if (d.count > 1) bubble(to, `+${d.count}`, 'warn');
  return sleep(DUR.draw);
}

function playFieldClear(
  d: Extract<EffectDescriptor, { kind: 'field-clear' }>,
  players: Player[],
  myId: string
): Promise<void> {
  if (!reducedMotion()) {
    const from = anchorTrumpField();
    for (let i = 0; i < 3; i++) {
      const el = spawn('<div class="mg-fx-tcard back"></div>', from, 'mg-fx-fly mg-fx-card', DUR.sweep);
      const dx = (Math.random() - 0.5) * 280;
      const dy = -40 - Math.random() * 60;
      el?.animate(
        [
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 0.9 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${dx > 0 ? 100 : -100}deg)`, opacity: 0 },
        ],
        { duration: DUR.sweep, delay: i * 40, easing: 'ease-out', fill: 'forwards' }
      );
    }
  }
  if (d.parentId) {
    const p = anchorPlayer(d.parentId, myId);
    const name = players.find(x => x.id === d.parentId)?.name ?? '';
    setTimeout(() => bubble(p, `👑 ${name}`, 'gold'), DUR.sweep * 0.5);
  }
  return sleep(DUR.sweep);
}

function playFinish(
  d: Extract<EffectDescriptor, { kind: 'finish' }>,
  players: Player[],
  myId: string
): Promise<void> {
  const p = anchorPlayer(d.playerId, myId);
  const name = players.find(x => x.id === d.playerId)?.name ?? '';
  bubble(p, `🏁 ${name} ${d.rank}位`, 'gold');
  return sleep(DUR.bubble * 0.5);
}

/**
 * ★UNOの色変更★ 場のフェルトの色は変わるが、それだけでは「今変わった」
 * ことに気づきにくい。新しい色の波紋をUNOの場から広げて知らせる。
 * 文字は使わず、色と形だけで伝える。
 */
export function flashColorChange(color: string): void {
  const p = anchorUnoField();
  const el = spawn('', p, `mg-fx-ripple c-${color}`, DUR.colorRipple);
  if (!el) return;
  if (reducedMotion()) {
    // 動きを抑える設定でも「変わった」ことは伝える必要があるので、静かに1回光らせる
    el.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }],
      { duration: DUR.colorRipple, easing: 'ease-out', fill: 'forwards' });
    return;
  }
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.35)', opacity: 0.95 },
      { transform: 'translate(-50%, -50%) scale(2.6)', opacity: 0 },
    ],
    { duration: DUR.colorRipple, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' }
  );
  // 場の枠も一度だけ強く光らせる（波紋を見逃しても色が変わったと分かる）
  const field = document.getElementById('mg-field');
  if (field) {
    field.classList.remove('color-flash');
    void field.offsetWidth; // リフローでアニメを頭から再生
    field.classList.add('color-flash');
    setTimeout(() => field.classList.remove('color-flash'), DUR.colorRipple);
  }
}

/**
 * ★対人リアクションの投擲★
 *
 * モバイルには投擲の概念が無く、送り主のチップにバッジが出るだけだったため
 * 「誰が誰に投げたか」が伝わらず、自分が投げたぶんに至っては（自分は②に
 * 並ばないので）画面のどこにも出ていなかった。
 * PC UIと同じく、送り主から宛先へ放物線で飛ばして着弾させる。
 * 自分が送り主／宛先のときは、カードの演出と同じく手札エリアを起点にする。
 */
export function flyReaction(emoji: string, fromId: string, toId: string, myId: string): void {
  const from = anchorPlayer(fromId, myId);
  const to = anchorPlayer(toId, myId);
  const land = (): void => {
    const hit = spawn(emoji, to, 'mg-fx-react hit', DUR.reactHit);
    hit?.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1 },
        { transform: 'translate(-50%, -50%) scale(1.9)', opacity: 0 },
      ],
      { duration: DUR.reactHit, easing: 'ease-out', fill: 'forwards' }
    );
  };

  if (reducedMotion()) { land(); return; }

  const el = spawn(emoji, from, 'mg-fx-react', DUR.reactFly);
  if (!el) return;
  // 山なりに飛ばす。中間点を上へ持ち上げるだけの3キーフレームで十分伝わる
  const midX = (to.x - from.x) / 2;
  const midY = (to.y - from.y) / 2 - Math.max(46, Math.abs(to.x - from.x) * 0.28);
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.75) rotate(0deg)', opacity: 0.9, offset: 0 },
      { transform: `translate(calc(-50% + ${midX}px), calc(-50% + ${midY}px)) scale(1.15) rotate(180deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(1) rotate(360deg)`, opacity: 1, offset: 1 },
    ],
    { duration: DUR.reactFly, easing: 'cubic-bezier(0.3, 0.1, 0.4, 1)', fill: 'forwards' }
  );
  setTimeout(land, DUR.reactFly);
}

/** 回転方向が変わったとき、環を一度光らせる */
export function flashRing(): void {
  const ring = document.getElementById('mg-ring');
  if (!ring) return;
  ring.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }],
    { duration: 460, easing: 'ease-in-out' });
}

/** 自分の手番になったことを手札エリアの光で知らせる */
export function flashMyTurn(): void {
  const hands = document.querySelector('.mg-hands');
  if (!hands || reducedMotion()) return;
  hands.classList.remove('mg-myturn');
  void (hands as HTMLElement).offsetWidth;
  hands.classList.add('mg-myturn');
  setTimeout(() => hands.classList.remove('mg-myturn'), 1400);
}

// ----------------------------------------
// エントリポイント
// ----------------------------------------
/**
 * 1つの演出を再生する。
 * trump-special（8切り・革命など）は既存の全画面演出 #trump-effect が
 * 担当しているので、ここでは何もしない（二重表示を避ける）。
 */
export function playMobileEffect(desc: EffectDescriptor, players: Player[], myId: string): Promise<void> {
  switch (desc.kind) {
    case 'trump-play':   return playTrumpPlay(desc, myId);
    case 'uno-play':     return playUnoPlay(desc, myId);
    case 'draw':         return playDraw(desc, myId);
    case 'pass':         bubble(anchorPlayer(desc.playerId, myId), 'パス'); return sleep(DUR.bubble * 0.45);
    case 'say-uno':      bubble(anchorPlayer(desc.playerId, myId), '📢 UNO!', 'uno'); return sleep(DUR.bubble * 0.5);
    case 'field-clear':  return playFieldClear(desc, players, myId);
    case 'finish':       return playFinish(desc, players, myId);
    case 'reverse':      flashRing(); return sleep(200);
    default:             return Promise.resolve();
  }
}
