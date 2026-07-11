// ========================================
// UI 描画モジュール
// ゲームロジックへの依存はなし。
// カード判定に必要な関数は ui-input.ts 経由でwindowに公開済みのものを使用する。
// ========================================
import { state } from '../state.js';
import { AVATAR_COLORS } from '../logic/game-init.js';
import { unoCardColorClass } from '../logic/uno-logic.js';
import {
  resetTrumpSelection,
  resetUnoSelection,
  isTrumpCardVisiblySelected,
  isUnoCardVisiblySelected,
} from './ui-input.js';
import type { GameState, Player, UnoCard } from '../logic/types';
import type { TrumpCard, TrumpEffect } from '../logic/trump-logic.js';

/** 他プレイヤーのリアクション表示（Firebaseの rooms/{id}/reactions/{playerId}） */
interface Reaction {
  emoji: string;
  ts: number;
}

// room はFirebaseから取得する生データのため any のまま扱う
// （players / game 等の各フィールドを使う箇所で必要な型に絞り込む）

// ----------------------------------------
// 画面切り替え
// ----------------------------------------
export function show(id: string): void {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + id)!.classList.add('active');
}

// ----------------------------------------
// メッセージ表示
// ----------------------------------------
export function setHomeMsg(text: string): void {
  document.getElementById('hm')!.textContent = text;
}
export function setLobbyMsg(text: string): void {
  document.getElementById('lm')!.textContent = text;
}
export function setStatus(msg: string, type?: string): void {
  const el = document.getElementById('fb-status')!;
  el.textContent = msg;
  el.className = 'msg' + (type ? ' ' + type : '');
}
export function dbg(msg: string, isErr = false): void {
  const el = document.getElementById('dbg-log');
  if (!el) return;
  const d = new Date();
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  el.innerHTML += `<div style="color:${isErr ? '#e74c3c' : 'inherit'}">[${t}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}
export function setLoading(btnId: string, loading: boolean, text: string): void {
  const b = document.getElementById(btnId) as HTMLButtonElement | null;
  if (!b) return;
  b.disabled = loading;
  b.textContent = loading ? text + '...' : text;
}

// ----------------------------------------
// ロビー画面の描画
// ----------------------------------------
export function renderLobby(room: any): void {
  const players: any[] = room.players || [];
  const pl = document.getElementById('lpl')!;
  pl.innerHTML = '';

  let allReady = true;
  players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'pi';
    let tags = '';
    if (p.id === state.myId) tags += '<span class="tag you">あなた</span>';
    if (p.id === room.host) tags += '<span class="tag host">ホスト</span>';
    tags += p.ready
      ? '<span class="tag ready">✓ Ready</span>'
      : '<span class="tag not-ready">準備中</span>';
    if (!p.ready) allReady = false;
    el.innerHTML = `
      <div class="av" style="background:${AVATAR_COLORS[i % 5]}">${p.name[0].toUpperCase()}</div>
      <span class="pi-name">${p.name}</span>
      <div class="pi-tags">${tags}</div>
    `;
    pl.appendChild(el);
  });

  const sb = document.getElementById('sbtn') as HTMLButtonElement;
  const rb = document.getElementById('rbtn') as HTMLButtonElement;

  if (state.myId === room.host) {
    sb.style.display = 'block';
    rb.style.display = 'none';
    if (players.length < 3) {
      sb.disabled = true;
      setLobbyMsg(`あと ${3 - players.length} 人必要です（最低3人）`);
    } else if (!allReady) {
      sb.disabled = true;
      setLobbyMsg('全員が準備完了するのを待っています...');
    } else {
      sb.disabled = false;
      setLobbyMsg(`全員準備完了！ゲームを開始できます (${players.length}人)`);
    }
  } else {
    sb.style.display = 'none';
    rb.style.display = 'block';
    const me = players.find(p => p.id === state.myId);
    if (me && me.ready) {
      rb.textContent = '準備をキャンセル';
      rb.className = 'btn';
      setLobbyMsg('ホストがゲームを開始するまで待ってね...');
    } else {
      rb.textContent = '準備完了！';
      rb.className = 'btn red';
      setLobbyMsg('準備ができたらボタンを押してね');
    }
  }
}

// ----------------------------------------
// ゲーム画面の描画
// ----------------------------------------
export function renderGame(room: any): void {
  const g: GameState = room.game;
  if (!g) return;

  // ui-input.ts の判定関数が最新のゲーム状態を参照できるよう同期する
  // ※ test-bot.ts が window._currentGame 用に独自定義した FusionGameState は、
  // types.ts の GameState とは別々に定義された「同じ実体を指す別の型」
  // （UnoCard/hasParent の型が微妙に異なる）のため、直接代入すると型エラーになる。
  // 実行時には同じオブジェクトなので、ここでは型だけ合わせる。
  window._currentGame = g as unknown as typeof window._currentGame;
  // ★バグ修正（app.js の window._currentTrumpHand と同じ原因）★
  // g.trumpHands が丸ごと undefined（全員トランプ0枚でFirebaseがノードごと
  // 削除した状態）になると、この if の中身が実行されず
  // window._currentTrumpHand が古い値のまま更新されなくなっていた。
  // 常に（空配列も込みで）更新する。
  window._currentTrumpHand = g.trumpHands?.[state.myId] ?? [];

  const players: Player[] = room.players || [];
  const reactions: Record<string, Reaction | undefined> = room.reactions || {};
  const autoPlayers: Record<string, boolean> = room.autoPlayers || {};
  const curId = g.order[g.ci]!;
  const isMyTurn = curId === state.myId;
  const phase = g.phase || 'trump';
  const myRankIdx = (g.rankings || []).findIndex(r => r.id === state.myId);
  const iFinished = myRankIdx !== -1;

  const myTrump = (g.trumpHands && g.trumpHands[state.myId]) || [];
  const myUno = (g.unoHands && g.unoHands[state.myId]) || [];
  const myTrumpDone = myTrump.length === 0;
  const myUnoDone = myUno.length === 0;

  _renderTurnBanner(g, players, isMyTurn, phase, iFinished);
  _renderPhaseIndicator(phase);
  _renderTurnOrder(g, players, curId);
  _renderOtherPlayers(g, players, reactions, curId, autoPlayers);
  _renderTrumpField(g);
  _renderTrumpStatus(g);
  _renderTrumpEffect(g, players);
  _renderParentBadge(g, players);
  _renderUnoField(g);
  _renderCurrentColor(g);
  _renderPenaltyWarning(g);

  // ★バグ修正（選択状態の残留）★
  // renderUnoHand/renderTrumpHand は window._selectedTrumpIds / _selectedUnoIdx を
  // そのまま参照する。カードを出した後に app.js 側の resetXxxSelection() 呼び出しが
  // Firebase のリアルタイム更新より後になる（＝タイミング次第で描画が先に走る）
  // ケースがあると、古い選択インデックスが残ったまま次に自分の番が回ってきた際、
  // 手札の並びが変わっている（配列がシフトしている）ため「本来選んでいないカード
  // （＝直前に出したカードの右隣だったカード）」が選択済み表示になり、
  // 送信ボタンまで出てしまっていた。
  // 対策として、「今このフェイズで自分が操作可能ではない」瞬間には
  // renderGame のたびに必ず選択状態をリセットする。これにより app.js 側の
  // リセット漏れ・タイミングのズレに関係なく、次に自分の番が来た時点では
  // 必ず選択なしの状態からスタートする（自己修復）。
  const canActTrump = isMyTurn && phase === 'trump' && !iFinished;
  const canActUno = isMyTurn && phase === 'uno' && !iFinished;
  if (!canActTrump) resetTrumpSelection();
  if (!canActUno) resetUnoSelection();

  renderTrumpHand(myTrump, canActTrump, g, iFinished, myTrumpDone);
  renderUnoHand(myUno, canActUno, g, iFinished, myUnoDone);

  _renderActionButtons(g, isMyTurn, phase, iFinished, myTrumpDone, myUnoDone);

  document.getElementById('cpick')?.classList.remove('show');

  _renderLog(room);
}

function _renderTurnBanner(g: GameState, players: Player[], isMyTurn: boolean, phase: string, iFinished: boolean): void {
  const tb = document.getElementById('tbnr')!;
  if (iFinished) {
    const myRankIdx = (g.rankings || []).findIndex(r => r.id === state.myId);
    tb.textContent = `🏁 上がり確定（${myRankIdx + 1}位・観戦中）`;
    tb.className = 'tb finished';
  } else if (isMyTurn) {
    tb.textContent = phase === 'trump'
      ? 'あなたのターン【①トランプフェイズ】'
      : 'あなたのターン【②UNOフェイズ】';
    tb.className = 'tb myturn';
  } else {
    const curId = g.order[g.ci];
    const cp = players.find(p => p.id === curId);
    tb.textContent = `${cp ? cp.name : '?'}のターン【${phase === 'trump' ? '①トランプ' : '②UNO'}】`;
    tb.className = 'tb wait';
  }
}

function _renderPhaseIndicator(phase: string): void {
  const pi = document.getElementById('phase-indicator');
  if (!pi) return;
  pi.innerHTML = `
    <span class="${phase === 'trump' ? 'phase-active' : 'phase-idle'}">① 🃏 トランプ</span>
    <span class="phase-arrow">→</span>
    <span class="${phase === 'uno' ? 'phase-active' : 'phase-idle'}">② 🎴 UNO</span>
  `;
}

// ----------------------------------------
// 手番の順番・回転方向インジケーター
// ----------------------------------------
// 「今どの順番で回っているか」「UNOのリバースがちゃんと効いているか」を
// 画面上ではっきり分かるようにする追加機能。
// g.order（現在アクティブなプレイヤーのみ、上がった人は除外済み）を
// g.dir の向きに沿って一列に並べ、現在の手番プレイヤーをハイライトする。
function _renderTurnOrder(g: GameState, players: Player[], curId: string): void {
  const el = document.getElementById('turn-order');
  if (!el) return;
  const order = Array.isArray(g.order) ? g.order : [];
  if (order.length === 0) { el.innerHTML = ''; return; }

  const isCW = g.dir === 1;
  const dirLabel = isCW ? '⟳ 時計回り' : '⟲ 反時計回り';
  const arrow = isCW ? '→' : '←';

  const seq = order.map(id => {
    const p = players.find(pl => pl.id === id);
    const name = p ? p.name : '?';
    const isCur = id === curId;
    return `<span class="to-player${isCur ? ' to-cur' : ''}">${isCur ? '👉' : ''}${name}</span>`;
  }).join(`<span class="to-arrow">${arrow}</span>`);

  el.innerHTML = `
    <span class="to-dir">${dirLabel}</span>
    <span class="to-seq">${seq}<span class="to-arrow">${arrow}</span><span class="to-loop">…</span></span>
  `;
}

function _renderOtherPlayers(
  g: GameState,
  players: Player[],
  reactions: Record<string, Reaction | undefined>,
  curId: string,
  autoPlayers: Record<string, boolean>
): void {
  const opl = document.getElementById('opl')!;
  opl.innerHTML = '';
  players.filter(p => p.id !== state.myId).forEach(p => {
    const tc = (g.trumpHands && g.trumpHands[p.id]) ? g.trumpHands[p.id]!.length : 0;
    const uc = (g.unoHands && g.unoHands[p.id]) ? g.unoHands[p.id]!.length : 0;
    const active = p.id === curId && g.order.includes(p.id);
    const rIdx = (g.rankings || []).findIndex(r => r.id === p.id);
    const react = reactions[p.id];
    const reactHtml = (react && Date.now() - react.ts < 4000)
      ? `<div class="react-badge">${react.emoji}</div>` : '';
    // ★機能追加★ 他プレイヤーが自動プレイ（テストボット）中かどうかを表示する
    const isAuto = !!(autoPlayers && autoPlayers[p.id]);
    const autoHtml = isAuto
      ? `<div class="auto-badge" style="font-size:11px;background:#8e44ad;color:#fff;border-radius:8px;padding:1px 6px;display:inline-block;margin-top:2px">🐒 自動プレイ中</div>`
      : '';
    const el = document.createElement('div');
    el.className = 'op' + (active ? ' cur' : '');
    el.innerHTML = `
      ${reactHtml}
      <div class="on">${p.name}</div>
      ${autoHtml}
      ${rIdx !== -1
        ? `<div class="oc finish-badge">🏁${rIdx + 1}位</div>`
        : `<div class="oc"><div class="trump-cnt">🃏${tc}枚</div><div class="uno-cnt">🎴${uc}枚</div></div>`
      }
    `;
    opl.appendChild(el);
  });
}

function _renderTrumpField(g: GameState): void {
  const tfEl = document.getElementById('trump-field');
  if (!tfEl) return;
  const fCards: TrumpCard[] = Array.isArray(g.trumpField) ? g.trumpField : (g.trumpField ? [g.trumpField] : []);
  if (fCards.length > 0) {
    tfEl.innerHTML = fCards.map(c => {
      const isRed = c.s === '♥' || c.s === '♦';
      return `<div class="trump-card${isRed ? ' red' : ''}">
        <span class="ts">${c.s}</span><span class="tv">${c.v}</span>
      </div>`;
    }).join('');
  } else {
    tfEl.innerHTML = `<div class="trump-empty">場は空<br><small>何でも出せる</small></div>`;
  }
}

function _renderTrumpStatus(g: GameState): void {
  const tfEl = document.getElementById('trump-field');
  if (!tfEl) return;
  let status = document.getElementById('trump-rule-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'trump-rule-status';
    status.className = 'trump-rule-status';
    tfEl.insertAdjacentElement('afterend', status);
  }

  const badges: [string, string][] = [];
  if (g.trumpRevolution) badges.push(['revolution', '革命']);
  if (g.trumpElevenBack) badges.push(['eleven', 'Jバック']);
  if (Array.isArray(g.trumpSuitLock) && g.trumpSuitLock.length > 0) {
    badges.push(['lock', `しばり ${g.trumpSuitLock.join('')}`]);
  }

  status.innerHTML = badges.map(([type, text]) =>
    `<span class="trump-rule-badge ${type}">${text}</span>`
  ).join('');
  status.style.display = badges.length > 0 ? 'flex' : 'none';
}

// 演出オーバーレイの自動クリア用タイマー
let _effectClearTimer: ReturnType<typeof setTimeout> | null = null;

function _renderTrumpEffect(g: GameState, players: Player[]): void {
  let el = document.getElementById('trump-effect');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trump-effect';
    el.className = 'trump-effect';
    document.body.appendChild(el);
  }

  // types.ts では trumpEffect は unknown（Firebase由来の生データ）として
  // 定義されているため、実際の形である TrumpEffect に絞り込んで扱う
  const effect = g.trumpEffect as TrumpEffect | null | undefined;
  if (!effect || !effect.ts || Date.now() - effect.ts > 2800) {
    el.className = 'trump-effect';
    el.innerHTML = '';
    return;
  }

  // 同じ演出が既に表示中なら再トリガーしない
  if (el.dataset.effectTs === String(effect.ts)) return;
  el.dataset.effectTs = String(effect.ts);

  const names: Record<string, string> = {
    eightCut: '✂️ 8切り',
    revolution: g.trumpRevolution ? '🌀 革命！' : '🌀 革命返し',
    elevenBack: '🔄 イレブンバック',
    suitLock: '⛓️ しばり',
    jokerSingle: '🃏 ジョーカー！',
    spadeThree: '♠ スペード3',
  };
  const messages: Record<string, string> = {
    eightCut: '場が流れた 👑 親になった',
    revolution: g.trumpRevolution ? '強さが全て逆転！' : '革命解除！通常の強さに戻った',
    elevenBack: 'この場だけ強さが逆転',
    suitLock: '同じマークのカードしか出せない',
    jokerSingle: '無敵のカード！場が流れた 👑 親になった',
    spadeThree: 'ジョーカーを返した 👑 親になった',
  };
  const types = Array.isArray(effect.types) ? effect.types : [effect.type];
  const title = types.map(t => names[t]).filter(Boolean).join(' / ') || 'SPECIAL';
  const mainType = effect.type || types[types.length - 1] || 'special';
  const playerName = players.find(p => p.id === effect.playerId)?.name || '';
  const message = messages[mainType] || '特殊効果発動';

  el.className = `trump-effect show ${mainType}`;
  el.innerHTML = `
    <div class="trump-effect-burst"></div>
    <div class="trump-effect-title">${title}</div>
    <div class="trump-effect-sub">${playerName ? playerName + ' - ' : ''}${message}</div>
  `;

  // アニメーション終了後に自動クリア（残像が残らないように）
  // ★バグ修正★ effectTs は削除しない。削除すると次の renderGame 呼び出しで
  // ガードが外れて同じ演出が再表示される。'cleared' ダミー値で上書きして
  // 同じ ts による再表示だけをブロックする。
  if (_effectClearTimer) clearTimeout(_effectClearTimer);
  _effectClearTimer = setTimeout(() => {
    const e = document.getElementById('trump-effect');
    if (e) {
      e.className = 'trump-effect';
      e.innerHTML = '';
      e.dataset.effectTs = 'cleared'; // ts を消さず、無効値で上書きする
    }
    _effectClearTimer = null;
  }, 2900);
}

function _renderParentBadge(g: GameState, players: Player[]): void {
  const parentBadge = document.getElementById('parent-badge');
  if (!parentBadge) return;
  if (g.hasParent) {
    const pName = players.find(p => p.id === g.hasParent)?.name || '?';
    const isMeParent = g.hasParent === state.myId;
    parentBadge.textContent = `👑 親: ${pName}${isMeParent ? '（あなた）' : ''}`;
    parentBadge.style.display = 'inline-block';
  } else {
    parentBadge.style.display = 'none';
  }
}

function _renderUnoField(g: GameState): void {
  const topUno = g.unoDiscardPile && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1]! : null;
  if (!topUno) return;
  const ufEl = document.getElementById('uno-field');
  if (ufEl) {
    ufEl.className = 'uno-field-card tc ' + unoCardColorClass(topUno);
    document.getElementById('uf-val')!.textContent = topUno.v;
    document.getElementById('uf-sym')!.textContent = topUno.v;
    document.getElementById('uf-sym2')!.textContent = topUno.v;
  }
}

function _renderCurrentColor(g: GameState): void {
  const ccEl = document.getElementById('current-color');
  if (!ccEl) return;
  const colorMap: Record<string, string> = { red: '🔴 赤', blue: '🔵 青', green: '🟢 緑', yellow: '🟡 黄' };
  ccEl.textContent = '現在の色: ' + (colorMap[g.unoCurrentColor] || g.unoCurrentColor);
  ccEl.className = 'current-color-badge cc-' + g.unoCurrentColor;
}

function _renderPenaltyWarning(g: GameState): void {
  const penEl = document.getElementById('penalty-warn');
  if (!penEl) return;
  if (g.unoPenaltyAccum > 0) {
    penEl.textContent = `⚠️ +${g.unoPenaltyAccum} 累積中！同種で返すかまとめて引く`;
    penEl.style.display = 'block';
  } else {
    penEl.style.display = 'none';
  }
}

function _renderActionButtons(
  g: GameState,
  isMyTurn: boolean,
  phase: string,
  iFinished: boolean,
  myTrumpDone: boolean,
  myUnoDone: boolean
): void {
  const myUno = (g.unoHands && g.unoHands[state.myId]) || [];
  const isMyUnoTurn = isMyTurn && phase === 'uno' && !iFinished;

  const tpassBtn = document.getElementById('trump-pass-btn');
  const tskipBtn = document.getElementById('trump-skip-btn');
  if (tpassBtn) tpassBtn.style.display = (isMyTurn && phase === 'trump' && !iFinished && !myTrumpDone) ? 'inline-block' : 'none';
  if (tskipBtn) tskipBtn.style.display = (isMyTurn && phase === 'trump' && !iFinished && myTrumpDone) ? 'inline-block' : 'none';

  // ★バグ修正★ UNO出し切り済みのプレイヤーには「引く」ボタンを出さない。
  // 出すカードがないのに引かされてしまうのを防ぐ（uno-skip-btn が代わりに表示される）。
  const udrawBtn = document.getElementById('uno-draw-btn');
  if (udrawBtn) {
    udrawBtn.style.display = (isMyUnoTurn && !myUnoDone) ? 'inline-block' : 'none';
    if (g.unoPenaltyAccum > 0) {
      udrawBtn.textContent = `ペナルティ ${g.unoPenaltyAccum} 枚引く`;
      udrawBtn.classList.add('penalty');
    } else {
      udrawBtn.textContent = 'UNOを1枚引く';
      udrawBtn.classList.remove('penalty');
    }
  }

  // ★バグ修正★ UNO出し切り済みのプレイヤーの自分のターンには
  // 自動スキップ用のボタンを表示する（トランプの uno-skip-btn と対になる仕組み）。
  // 自分が親の場合は、色変更権限を使わずに進める旨がわかるよう文言を変える。
  const uskipBtn = document.getElementById('uno-skip-btn');
  if (uskipBtn) {
    const isParent = g.hasParent === state.myId;
    uskipBtn.style.display = (isMyUnoTurn && myUnoDone) ? 'inline-block' : 'none';
    uskipBtn.textContent = isParent
      ? '色を変更せず次へ進む ▶'
      : 'UNO0枚 → 次のトランプフェイズへ ▶';
  }

  // ★バグ修正★ uno-play-btn は selectUnoCard が呼ばれた時しか表示制御されておらず、
  // ターンが他人に移っても選択状態のまま残留していた。
  // renderGame のたびに必ずここで自分のターンかどうかを再評価する。
  const uplayBtn = document.getElementById('uno-play-btn');
  if (uplayBtn) {
    const hasSelection = window._selectedUnoIdx !== null && window._selectedUnoIdx !== undefined;
    uplayBtn.style.display = (isMyUnoTurn && !myUnoDone && hasSelection) ? 'inline-block' : 'none';
  }

  const unoBtn = document.getElementById('uno-btn');
  if (unoBtn) {
    const showUno = !iFinished && !myUnoDone && isMyTurn && phase === 'uno'
      && myUno.length <= 2 && !(g.unoSaid && g.unoSaid[state.myId]);
    unoBtn.style.display = showUno ? 'inline-block' : 'none';
  }

  const parentColorBtn = document.getElementById('parent-color-btn');
  if (parentColorBtn) {
    const isParentNow = isMyTurn && phase === 'uno' && g.hasParent === state.myId;
    parentColorBtn.style.display = isParentNow ? 'block' : 'none';
    parentColorBtn.textContent = (isParentNow && myUnoDone)
      ? '👑 親の権限：UNOの色を変更する（UNO出し切り済み・行使すると次のプレイヤーへ）'
      : '👑 親の権限：UNOの色を強制変更する';
  }
}

function _renderLog(room: any): void {
  const logEl = document.getElementById('glog')!;
  const logs: string[] = room.log || [];
  logEl.innerHTML = logs.slice(-6).map(l => `<div class="log-entry">${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

// ----------------------------------------
// トランプ手札の描画
// ----------------------------------------
export function renderTrumpHand(hand: TrumpCard[], canAct: boolean, g: GameState, iFinished: boolean, myTrumpDone: boolean): void {
  const el = document.getElementById('my-trump-hand'); if (!el) return;
  const cntEl = document.getElementById('trump-cnt'); if (cntEl) cntEl.textContent = String(hand.length);

  if (iFinished) { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myTrumpDone) { el.innerHTML = `<div class="hand-done">✅ トランプ出し切り！UNOフェイズのみ</div>`; return; }

  const selectedIds = window._selectedTrumpIds || [];

  el.innerHTML = '';
  hand.forEach(card => {
    const canPlay = canAct && window.trumpCanPlayCard(card, g.trumpField, selectedIds);
    const isRed = card.s === '♥' || card.s === '♦';
    // ★バグ修正★ canAct でない（＝自分のトランプターンではない）場合は
    // window._selectedTrumpIds が古い値のままでも見た目上は選択済みにしない。
    const isSelected = isTrumpCardVisiblySelected(card.id, selectedIds, canAct);
    const div = document.createElement('div');
    div.className = `trump-hand-card${isRed ? ' red' : ''}${!canPlay && !isSelected ? ' off' : ''}${isSelected ? ' selected' : ''}`;
    div.dataset.cardId = card.id;
    div.dataset.canPlay = canPlay ? '1' : '0';
    div.innerHTML = `<span class="ts">${card.s}</span><span class="tv">${card.v}</span>`;
    if (canPlay || isSelected) div.onclick = () => window.selectTrumpCard(card.id);
    el.appendChild(div);
  });
}

// ----------------------------------------
// UNO手札の描画
// ----------------------------------------
export function renderUnoHand(hand: UnoCard[], canAct: boolean, g: GameState, iFinished: boolean, myUnoDone: boolean): void {
  const el = document.getElementById('my-uno-hand'); if (!el) return;
  const cntEl = document.getElementById('uno-cnt-my'); if (cntEl) cntEl.textContent = String(hand.length);

  if (iFinished) { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myUnoDone) { el.innerHTML = `<div class="hand-done">✅ UNO出し切り！トランプフェイズのみ</div>`; return; }

  const selectedIdx = window._selectedUnoIdx;
  const topUno = g.unoDiscardPile && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1]! : null;

  el.innerHTML = '';
  hand.forEach((card, idx) => {
    // unoCanPlay の判定は ui-input.ts が window.unoCanPlayCard として公開する
    const canPlay = canAct && topUno && typeof window.unoCanPlayCard === 'function'
      ? window.unoCanPlayCard(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum)
      : false;
    // ★バグ修正★ canAct でない（＝自分のUNOターンではない）場合は
    // window._selectedUnoIdx が古い値のままでも見た目上は選択済みにしない。
    const isSelected = isUnoCardVisiblySelected(idx, selectedIdx, canAct);
    const div = document.createElement('div');
    div.className = `hcd ${unoCardColorClass(card)}${!canPlay && !isSelected ? ' off' : ''}${isSelected ? ' selected' : ''}`;
    div.dataset.cardIdx = String(idx);
    div.innerHTML = `<span class="hs">${card.v}</span>${card.v}<span class="hs br">${card.v}</span>`;
    if (canPlay || isSelected) div.onclick = () => window.selectUnoCard(idx);
    el.appendChild(div);
  });
}

// ----------------------------------------
// リザルト画面の描画
// ----------------------------------------
export function renderResult(room: any): void {
  const g = room.game;
  const rankings: { id: string; name: string }[] = (g && g.rankings) || [];
  const rlist = document.getElementById('rlist')!;
  rlist.innerHTML = '';

  rankings.forEach((r, idx) => {
    const medal = ['🥇', '🥈', '🥉'][idx] || `${idx + 1}位`;
    const isMe = r.id === state.myId
      ? '<span class="tag you" style="margin:0">あなた</span>' : '';
    const el = document.createElement('div');
    el.className = 'rank-row' + (r.id === state.myId ? ' rank-me' : '');
    el.innerHTML = `<span class="rank-medal">${medal}</span><span class="rank-name">${r.name}</span>${isMe}`;
    rlist.appendChild(el);
  });

  const myRankIdx = rankings.findIndex(r => r.id === state.myId);
  const ric = document.getElementById('ric')!;
  const rtit = document.getElementById('rtit')!;
  if (myRankIdx === 0) { ric.textContent = '👑'; rtit.textContent = 'あなたが1位！'; }
  else if (myRankIdx !== -1) { ric.textContent = '🏁'; rtit.textContent = `${myRankIdx + 1}位でゴール！`; }
  else { ric.textContent = '😅'; rtit.textContent = 'ゲーム終了！'; }

  // ★バグ修正★ 以前はホスト以外だと disabled=true になり「ホストが
  // 再開するのを待っています...」という文言で押せなくしていた。
  // しかし backToLobby()（auth.js）は誰が呼んでもロビーへ戻れる実装に
  // なっており、Firebase側の初期化も「まだ誰もリセットしていない場合のみ」
  // 行う安全な作りになっている。そのため、ここでホストだけに限定する
  // 必要はそもそも無い。全員が同じ「ロビーに戻る」ボタンを押せるようにする。
  const resBtn = document.getElementById('res-back-btn') as HTMLButtonElement;
  resBtn.style.display = 'block';
  resBtn.disabled = false;
  resBtn.textContent = 'ロビーに戻る';
}

// ----------------------------------------
// リアクションフィードバック
// ----------------------------------------
export function flashReactionBtn(emoji: string): void {
  document.querySelectorAll<HTMLElement>('.react-btn').forEach(b => {
    if (b.dataset.emoji === emoji) {
      b.classList.add('reacted');
      showSelfReaction(emoji);
      setTimeout(() => b.classList.remove('reacted'), 1500);
    }
  });
}

export function showSelfReaction(emoji: string): void {
  let popup = document.getElementById('self-react-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'self-react-popup';
    document.body.appendChild(popup);
  }
  popup.textContent = emoji;
  popup.classList.remove('pop-anim');
  void popup.offsetWidth;
  popup.classList.add('pop-anim');
}
