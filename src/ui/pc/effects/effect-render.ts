// ========================================
// 演出のDOM実装
//
// EffectDescriptor を受け取り、演出レイヤー（#pcg-effect-layer）上で
// Web Animations API を使って再生する。ゾーンの再描画とは独立して
// 最後まで再生される（座標は開始時にアンカーから実測）。
//
// テンポ方針: キビキビ（1演出 300〜1300ms）。
// prefers-reduced-motion のユーザーには飛翔系を省略してバナーのみにする。
// ========================================
import type { EffectDescriptor } from './effect-derive.js';
import {
  anchorSeat,
  anchorTrumpField,
  anchorUnoField,
  anchorDeck,
  anchorCenter,
  anchorOwnHand,
  type AnchorPoint,
} from './anchors.js';
import { pcTrumpCardHtml, pcUnoCardHtml } from '../cards.js';
import type { Player } from '../../../logic/types';

// ---- テンポ定数（ms） ----
const DUR = {
  flight: 320,        // カード飛翔
  flightStagger: 50,  // 複数枚のずらし
  drawPer: 220,       // ドロー1枚
  drawStagger: 70,
  passBubble: 650,
  sayUno: 900,
  fieldSweep: 550,
  crownDrop: 450,
  banner: 1300,
  reverse: 750,
  finish: 1400,
  gameStart: 2800,   // ★ゲーム開始はゆっくり見せる（進行を急かす必要がないため）
  turnFlash: 300,
  myTurn: 1700,      // 自分のターン専用演出
};

function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function layer(): HTMLElement | null {
  return document.getElementById('pcg-effect-layer');
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/** レイヤーに一時要素を追加する（durationMs後に自動削除） */
function spawn(html: string, x: number, y: number, cls: string, durationMs: number): HTMLElement | null {
  const l = layer();
  if (!l) return null;
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = html;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  l.appendChild(el);
  setTimeout(() => el.remove(), durationMs + 200);
  return el;
}

/** カード1枚を from → to へ飛ばす */
function flyCard(cardHtml: string, from: AnchorPoint, to: AnchorPoint, delayMs: number): void {
  const el = spawn(cardHtml, from.x, from.y, 'pcg-fx-fly', DUR.flight + delayMs);
  if (!el) return;
  const rot = (Math.random() - 0.5) * 40;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(1.05) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.95) rotate(${rot}deg)`, opacity: 0.9 },
    ],
    { duration: DUR.flight, delay: delayMs, easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)', fill: 'forwards' }
  );
}

/** 席の上に短い吹き出しを出す */
function bubbleAt(p: AnchorPoint, text: string, durationMs: number, extraCls = ''): void {
  const el = spawn(text, p.x, p.y - 34, `pcg-fx-bubble ${extraCls}`, durationMs);
  if (!el) return;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -60%) scale(1)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -70%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%, -85%) scale(0.95)', opacity: 0 },
    ],
    { duration: durationMs, easing: 'ease-out', fill: 'forwards' }
  );
}

/** 画面中央のバナー */
function centerBanner(html: string, durationMs: number, cls = ''): void {
  const c = anchorCenter();
  const el = spawn(html, c.x, c.y, `pcg-fx-banner ${cls}`, durationMs);
  if (!el) return;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.06)', opacity: 1, offset: 0.14 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.82 },
      { transform: 'translate(-50%, -55%) scale(1.02)', opacity: 0 },
    ],
    { duration: durationMs, easing: 'ease', fill: 'forwards' }
  );
}

const COLOR_INFO: Record<string, { label: string; hex: string }> = {
  red:    { label: '赤', hex: '#d64541' },
  blue:   { label: '青', hex: '#2e86de' },
  green:  { label: '緑', hex: '#27ae60' },
  yellow: { label: '黄', hex: '#e5b800' },
};

// ----------------------------------------
// 各演出の実装
// ----------------------------------------

function playTrumpPlay(desc: Extract<EffectDescriptor, { kind: 'trump-play' }>, myId: string): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = anchorSeat(desc.playerId, myId);
  const to = anchorTrumpField();
  const cards = desc.cards.slice(0, 4); // 革命の大量出しでも最大4枚まで
  cards.forEach((card, i) => flyCard(pcTrumpCardHtml(card), from, to, i * DUR.flightStagger));
  return sleep(DUR.flight + cards.length * DUR.flightStagger);
}

function playUnoPlay(desc: Extract<EffectDescriptor, { kind: 'uno-play' }>, myId: string): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = anchorSeat(desc.playerId, myId);
  const to = anchorUnoField();
  const cardHtml = desc.card
    ? pcUnoCardHtml(desc.card as any)
    : '<div class="pcg-cardback"></div>'; // カード未記録の古いログはカード裏で代替
  flyCard(cardHtml, from, to, 0);

  // 特殊カードは着弾時に小さくバースト表示
  const t = desc.card?.t;
  const burst = t === 'skip' ? '⊘' : t === 'd2' ? '+2' : t === 'w4' ? '+4' : null;
  if (burst) {
    setTimeout(() => bubbleAt(to, burst, 600, 'pcg-fx-burst'), DUR.flight - 40);
    return sleep(DUR.flight + 300);
  }
  return sleep(DUR.flight);
}

function playDraw(desc: Extract<EffectDescriptor, { kind: 'draw' }>, myId: string): Promise<void> {
  if (reducedMotion()) return Promise.resolve();
  const from = anchorDeck();
  const to = anchorSeat(desc.playerId, myId);
  const n = Math.min(desc.count, 4); // 大量ペナルティでも最大4枚まで見せる
  for (let i = 0; i < n; i++) {
    const el = spawn('<div class="pcg-cardback"></div>', from.x, from.y, 'pcg-fx-fly', DUR.drawPer + i * DUR.drawStagger);
    el?.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.7)`, opacity: 0.4 },
      ],
      { duration: DUR.drawPer, delay: i * DUR.drawStagger, easing: 'ease-in', fill: 'forwards' }
    );
  }
  if (desc.count > 1) bubbleAt(to, `+${desc.count}枚`, 700, 'pcg-fx-burst');
  return sleep(DUR.drawPer + n * DUR.drawStagger);
}

function playPass(desc: Extract<EffectDescriptor, { kind: 'pass' }>, myId: string): Promise<void> {
  bubbleAt(anchorSeat(desc.playerId, myId), 'パス', DUR.passBubble);
  return sleep(DUR.passBubble * 0.6); // 吹き出しの後半は次の演出と重なってよい
}

function playSayUno(desc: Extract<EffectDescriptor, { kind: 'say-uno' }>, myId: string): Promise<void> {
  bubbleAt(anchorSeat(desc.playerId, myId), '📢 UNO!', DUR.sayUno, 'pcg-fx-uno');
  return sleep(DUR.sayUno * 0.6);
}

function playParentColor(
  desc: Extract<EffectDescriptor, { kind: 'parent-color' }>,
  players: Player[]
): Promise<void> {
  const name = players.find(p => p.id === desc.playerId)?.name ?? '?';
  const c = COLOR_INFO[desc.color] ?? { label: desc.color, hex: '#fff' };
  centerBanner(
    `<div class="pcg-ep-crown">👑</div>
     <div class="pcg-ep-title">親の権限発動！</div>
     <div class="pcg-ep-sub">${name} が色を <span class="pcg-ep-color" style="background:${c.hex}"></span><b>${c.label}</b> に変更</div>`,
    DUR.banner
  );
  return sleep(DUR.banner * 0.7);
}

function playFieldClear(
  desc: Extract<EffectDescriptor, { kind: 'field-clear' }>,
  players: Player[],
  myId: string
): Promise<void> {
  // 場のカードが払われて飛散する
  if (!reducedMotion()) {
    const from = anchorTrumpField();
    for (let i = 0; i < 3; i++) {
      const el = spawn('<div class="pcg-cardback"></div>', from.x, from.y, 'pcg-fx-fly', DUR.fieldSweep);
      const dx = (Math.random() - 0.5) * 500;
      const dy = -60 - Math.random() * 80;
      el?.animate(
        [
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 0.9 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${dx > 0 ? 120 : -120}deg)`, opacity: 0 },
        ],
        { duration: DUR.fieldSweep, delay: i * 40, easing: 'ease-out', fill: 'forwards' }
      );
    }
  }
  // 👑 が新しい親の席に降ってくる
  if (desc.parentId) {
    const seat = anchorSeat(desc.parentId, myId);
    const name = players.find(p => p.id === desc.parentId)?.name ?? '?';
    setTimeout(() => {
      const el = spawn('👑', seat.x, seat.y, 'pcg-fx-crown', DUR.crownDrop + 600);
      el?.animate(
        [
          { transform: 'translate(-50%, -220%) scale(1.6)', opacity: 0 },
          { transform: 'translate(-50%, -80%) scale(1)', opacity: 1, offset: 0.55 },
          { transform: 'translate(-50%, -95%) scale(1.1)', opacity: 1, offset: 0.75 },
          { transform: 'translate(-50%, -80%) scale(1)', opacity: 0 },
        ],
        { duration: DUR.crownDrop + 600, easing: 'ease-out', fill: 'forwards' }
      );
      bubbleAt(seat, `${name} が親に！`, 800, 'pcg-fx-burst');
    }, DUR.fieldSweep * 0.5);
  }
  return sleep(DUR.fieldSweep + DUR.crownDrop);
}

function playReverse(desc: Extract<EffectDescriptor, { kind: 'reverse' }>): Promise<void> {
  centerBanner(
    `<div class="pcg-fx-rev-icon">${desc.dir === 1 ? '⟳' : '⟲'}</div><div class="pcg-ep-title">⇄ リバース！</div>`,
    DUR.reverse
  );
  return sleep(DUR.reverse * 0.7);
}

function playFinish(
  desc: Extract<EffectDescriptor, { kind: 'finish' }>,
  players: Player[],
  myId: string
): Promise<void> {
  const seat = anchorSeat(desc.playerId, myId);
  const name = players.find(p => p.id === desc.playerId)?.name ?? '?';
  bubbleAt(seat, `🏁 ${name} ${desc.rank}位で上がり！`, DUR.finish, 'pcg-fx-finish');
  // 紙吹雪
  if (!reducedMotion()) {
    const colors = ['#d64541', '#2e86de', '#27ae60', '#e5b800', '#ffd166'];
    for (let i = 0; i < 14; i++) {
      const el = spawn('', seat.x, seat.y, 'pcg-fx-confetti', DUR.finish);
      if (!el) continue;
      el.style.background = colors[i % colors.length]!;
      const dx = (Math.random() - 0.5) * 240;
      const dy = 60 + Math.random() * 120;
      el.animate(
        [
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${dx * 4}deg)`, opacity: 0 },
        ],
        { duration: DUR.finish * (0.6 + Math.random() * 0.4), easing: 'ease-out', fill: 'forwards' }
      );
    }
  }
  return sleep(DUR.finish * 0.55);
}

function playGameStart(desc: Extract<EffectDescriptor, { kind: 'game-start' }>, myId: string): Promise<void> {
  centerBanner(
    `<div class="pcg-fx-start-icon">🎮</div>
     <div class="pcg-ep-title">ゲーム開始！</div>
     <div class="pcg-ep-sub">♦3を持つ <b>${desc.firstPlayerName}</b> が先手</div>`,
    DUR.gameStart
  );
  // ディール演出: 中央から各席へ、複数ラウンドに分けてゆっくりカードを配る
  if (!reducedMotion()) {
    const from = anchorCenter();
    const dealFlight = 480;
    const rounds = 3; // 各席へ3枚ずつ配る風に
    for (let round = 0; round < rounds; round++) {
      desc.seatIds.forEach((id, i) => {
        const to = anchorSeat(id, myId);
        const delay = 350 + round * 520 + i * 90;
        const el = spawn('<div class="pcg-cardback"></div>', from.x, from.y, 'pcg-fx-fly', dealFlight + delay);
        el?.animate(
          [
            { transform: 'translate(-50%, -50%) scale(0.9) rotate(0deg)', opacity: 1 },
            { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.55) rotate(${(Math.random() - 0.5) * 30}deg)`, opacity: 0 },
          ],
          { duration: dealFlight, delay, easing: 'ease-out', fill: 'forwards' }
        );
      });
    }
  }
  return sleep(DUR.gameStart * 0.85);
}

// 特殊効果（applyTrumpPlay 由来）のバナー表記
const SPECIAL_LABELS: Record<string, string> = {
  eightCut:    '✂️ 8切り！',
  elevenBack:  '🔄 イレブンバック！',
  suitLock:    '⛓ しばり！',
  jokerSingle: '🃏 ジョーカー！',
  spadeThree:  '♠3 ジョーカー返し！',
};

function playTrumpSpecial(
  desc: Extract<EffectDescriptor, { kind: 'trump-special' }>,
  players: Player[]
): Promise<void> {
  const name = players.find(p => p.id === desc.playerId)?.name ?? '';
  const labels = desc.types.map(t =>
    t === 'revolution' ? (desc.revolutionOn ? '🌀 革命！' : '🌀 革命返し！') : SPECIAL_LABELS[t]
  ).filter(Boolean);
  if (labels.length === 0) return Promise.resolve();

  // 革命はテーブル全体を一瞬フラッシュさせる
  if (desc.types.includes('revolution')) {
    const l = layer();
    if (l && !reducedMotion()) {
      const flash = document.createElement('div');
      flash.className = 'pcg-fx-revflash';
      l.appendChild(flash);
      flash.animate(
        [{ opacity: 0 }, { opacity: 0.55, offset: 0.3 }, { opacity: 0 }],
        { duration: 500, easing: 'ease-out', fill: 'forwards' }
      );
      setTimeout(() => flash.remove(), 700);
    }
  }

  centerBanner(
    `<div class="pcg-ep-title pcg-fx-special-title">${labels.join(' / ')}</div>
     ${name ? `<div class="pcg-ep-sub">${name}</div>` : ''}`,
    DUR.banner
  );
  return sleep(DUR.banner * 0.7);
}

// ----------------------------------------
// エントリポイント
// ----------------------------------------
export function playEffect(desc: EffectDescriptor, players: Player[], myId: string): Promise<void> {
  switch (desc.kind) {
    case 'game-start':    return playGameStart(desc, myId);
    case 'trump-play':    return playTrumpPlay(desc, myId);
    case 'uno-play':      return playUnoPlay(desc, myId);
    case 'draw':          return playDraw(desc, myId);
    case 'pass':          return playPass(desc, myId);
    case 'say-uno':       return playSayUno(desc, myId);
    case 'parent-color':  return playParentColor(desc, players);
    case 'field-clear':   return playFieldClear(desc, players, myId);
    case 'reverse':       return playReverse(desc);
    case 'finish':        return playFinish(desc, players, myId);
    case 'trump-special': return playTrumpSpecial(desc, players);
    default:              return Promise.resolve();
  }
}

/**
 * 手番が移った席のリングを一瞬光らせる（キューに乗せない即時演出。
 * bot対戦では毎秒発生するため、順次再生キューに入れると渋滞する）
 */
export function flashTurnArrival(playerId: string, myId: string): void {
  if (reducedMotion()) return;
  const p = anchorSeat(playerId, myId);
  const el = spawn('', p.x, p.y, 'pcg-fx-turnflash', DUR.turnFlash);
  el?.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) scale(1.7)', opacity: 0 },
    ],
    { duration: DUR.turnFlash, easing: 'ease-out', fill: 'forwards' }
  );
}

/**
 * 自分のターンが来たことをはっきり知らせる演出（キュー外・即時）。
 * 「自分の番に気づかない」問題への対応。手札エリアの枠を光らせ、
 * その上に「▶ あなたのターン」トーストを出す。
 * reduced-motion でも重要情報なのでトーストは出す（枠グローだけ省略）。
 */
export function flashMyTurn(): void {
  const own = document.getElementById('pcg-own');
  if (own && !reducedMotion()) {
    own.classList.remove('pcg-myturn-flash');
    void own.offsetWidth; // reflow でアニメーションを確実に再起動
    own.classList.add('pcg-myturn-flash');
    setTimeout(() => own.classList.remove('pcg-myturn-flash'), DUR.myTurn);
  }
  const p = anchorOwnHand();
  const el = spawn('▶ あなたのターン', p.x, p.y - 92, 'pcg-fx-myturn', DUR.myTurn);
  if (!el) return;
  el.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.7)', opacity: 0 },
      { transform: 'translate(-50%, -60%) scale(1.05)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%, -60%) scale(1)', opacity: 1, offset: 0.8 },
      { transform: 'translate(-50%, -70%) scale(0.98)', opacity: 0 },
    ],
    { duration: DUR.myTurn, easing: 'ease-out', fill: 'forwards' }
  );
}
