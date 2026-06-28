// ========================================
// UI 描画モジュール
// ゲームロジックへの依存はなし。
// カード判定に必要な関数は ui-input.js 経由でwindowに公開済みのものを使用する。
// ========================================
import { state } from './state.js';
import { AVATAR_COLORS } from './game-init.js';
import { unoCardColorClass } from './uno-logic.js';

// ----------------------------------------
// 画面切り替え
// ----------------------------------------
export function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('s-' + id).classList.add('active');
}

// ----------------------------------------
// メッセージ表示
// ----------------------------------------
export function setHomeMsg(text) {
  document.getElementById('hm').textContent = text;
}
export function setLobbyMsg(text) {
  document.getElementById('lm').textContent = text;
}
export function setStatus(msg, type) {
  const el = document.getElementById('fb-status');
  el.textContent = msg;
  el.className = 'msg' + (type ? ' ' + type : '');
}
export function dbg(msg, isErr = false) {
  const el = document.getElementById('dbg-log');
  if (!el) return;
  const d = new Date();
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  el.innerHTML += `<div style="color:${isErr ? '#e74c3c' : 'inherit'}">[${t}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}
export function setLoading(btnId, loading, text) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = loading;
  b.textContent = loading ? text + '...' : text;
}

// ----------------------------------------
// ロビー画面の描画
// ----------------------------------------
export function renderLobby(room) {
  const players = room.players || [];
  const pl = document.getElementById('lpl');
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

  const sb = document.getElementById('sbtn');
  const rb = document.getElementById('rbtn');

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
export function renderGame(room) {
  const g = room.game;
  if (!g) return;

  // ui-input.js の判定関数が最新のゲーム状態を参照できるよう同期する
  window._currentGame = g;
  if (g.trumpHands) {
    window._currentTrumpHand = g.trumpHands[state.myId] ?? [];
  }

  const players = room.players || [];
  const reactions = room.reactions || {};
  const curId = g.order[g.ci];
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
  _renderOtherPlayers(g, players, reactions, curId);
  _renderTrumpField(g);
  _renderTrumpStatus(g);
  _renderTrumpEffect(g, players);
  _renderParentBadge(g, players);
  _renderUnoField(g);
  _renderCurrentColor(g);
  _renderPenaltyWarning(g);

  renderTrumpHand(myTrump, isMyTurn && phase === 'trump', g, iFinished, myTrumpDone);
  renderUnoHand(myUno, isMyTurn && phase === 'uno', g, iFinished, myUnoDone);

  _renderActionButtons(g, isMyTurn, phase, iFinished, myTrumpDone, myUnoDone);

  document.getElementById('cpick')?.classList.remove('show');

  _renderLog(room);
}

function _renderTurnBanner(g, players, isMyTurn, phase, iFinished) {
  const tb = document.getElementById('tbnr');
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

function _renderPhaseIndicator(phase) {
  const pi = document.getElementById('phase-indicator');
  if (!pi) return;
  pi.innerHTML = `
    <span class="${phase === 'trump' ? 'phase-active' : 'phase-idle'}">① 🃏 トランプ</span>
    <span class="phase-arrow">→</span>
    <span class="${phase === 'uno' ? 'phase-active' : 'phase-idle'}">② 🎴 UNO</span>
  `;
}

function _renderOtherPlayers(g, players, reactions, curId) {
  const opl = document.getElementById('opl');
  opl.innerHTML = '';
  players.filter(p => p.id !== state.myId).forEach(p => {
    const tc = (g.trumpHands && g.trumpHands[p.id]) ? g.trumpHands[p.id].length : 0;
    const uc = (g.unoHands && g.unoHands[p.id]) ? g.unoHands[p.id].length : 0;
    const active = p.id === curId && g.order.includes(p.id);
    const rIdx = (g.rankings || []).findIndex(r => r.id === p.id);
    const react = reactions[p.id];
    const reactHtml = (react && Date.now() - react.ts < 4000)
      ? `<div class="react-badge">${react.emoji}</div>` : '';
    const el = document.createElement('div');
    el.className = 'op' + (active ? ' cur' : '');
    el.innerHTML = `
      ${reactHtml}
      <div class="on">${p.name}</div>
      ${rIdx !== -1
        ? `<div class="oc finish-badge">🏁${rIdx + 1}位</div>`
        : `<div class="oc"><div class="trump-cnt">🃏${tc}枚</div><div class="uno-cnt">🎴${uc}枚</div></div>`
      }
    `;
    opl.appendChild(el);
  });
}

function _renderTrumpField(g) {
  const tfEl = document.getElementById('trump-field');
  if (!tfEl) return;
  const fCards = Array.isArray(g.trumpField) ? g.trumpField : (g.trumpField ? [g.trumpField] : []);
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

function _renderTrumpStatus(g) {
  const tfEl = document.getElementById('trump-field');
  if (!tfEl) return;
  let status = document.getElementById('trump-rule-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'trump-rule-status';
    status.className = 'trump-rule-status';
    tfEl.insertAdjacentElement('afterend', status);
  }

  const badges = [];
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
let _effectClearTimer = null;

function _renderTrumpEffect(g, players) {
  let el = document.getElementById('trump-effect');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trump-effect';
    el.className = 'trump-effect';
    document.body.appendChild(el);
  }

  const effect = g.trumpEffect;
  if (!effect || !effect.ts || Date.now() - effect.ts > 2800) {
    el.className = 'trump-effect';
    el.innerHTML = '';
    return;
  }

  // 同じ演出が既に表示中なら再トリガーしない
  if (el.dataset.effectTs === String(effect.ts)) return;
  el.dataset.effectTs = String(effect.ts);

  const names = {
    eightCut: '✂️ 8切り',
    revolution: g.trumpRevolution ? '🌀 革命！' : '🌀 革命返し',
    elevenBack: '🔄 イレブンバック',
    suitLock: '⛓️ しばり',
    jokerSingle: '🃏 ジョーカー！',
    spadeThree: '♠ スペード3',
  };
  const messages = {
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
  if (_effectClearTimer) clearTimeout(_effectClearTimer);
  _effectClearTimer = setTimeout(() => {
    const e = document.getElementById('trump-effect');
    if (e) { e.className = 'trump-effect'; e.innerHTML = ''; delete e.dataset.effectTs; }
    _effectClearTimer = null;
  }, 2900);
}

function _renderParentBadge(g, players) {
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

function _renderUnoField(g) {
  const topUno = g.unoDiscardPile && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1] : null;
  if (!topUno) return;
  const ufEl = document.getElementById('uno-field');
  if (ufEl) {
    ufEl.className = 'uno-field-card tc ' + unoCardColorClass(topUno);
    document.getElementById('uf-val').textContent = topUno.v;
    document.getElementById('uf-sym').textContent = topUno.v;
    document.getElementById('uf-sym2').textContent = topUno.v;
  }
}

function _renderCurrentColor(g) {
  const ccEl = document.getElementById('current-color');
  if (!ccEl) return;
  const colorMap = { red: '🔴 赤', blue: '🔵 青', green: '🟢 緑', yellow: '🟡 黄' };
  ccEl.textContent = '現在の色: ' + (colorMap[g.unoCurrentColor] || g.unoCurrentColor);
  ccEl.className = 'current-color-badge cc-' + g.unoCurrentColor;
}

function _renderPenaltyWarning(g) {
  const penEl = document.getElementById('penalty-warn');
  if (!penEl) return;
  if (g.unoPenaltyAccum > 0) {
    penEl.textContent = `⚠️ +${g.unoPenaltyAccum} 累積中！同種で返すかまとめて引く`;
    penEl.style.display = 'block';
  } else {
    penEl.style.display = 'none';
  }
}

function _renderActionButtons(g, isMyTurn, phase, iFinished, myTrumpDone, myUnoDone) {
  const myUno = (g.unoHands && g.unoHands[state.myId]) || [];

  const tpassBtn = document.getElementById('trump-pass-btn');
  const tskipBtn = document.getElementById('trump-skip-btn');
  if (tpassBtn) tpassBtn.style.display = (isMyTurn && phase === 'trump' && !iFinished && !myTrumpDone) ? 'inline-block' : 'none';
  if (tskipBtn) tskipBtn.style.display = (isMyTurn && phase === 'trump' && !iFinished && myTrumpDone) ? 'inline-block' : 'none';

  const udrawBtn = document.getElementById('uno-draw-btn');
  if (udrawBtn) {
    udrawBtn.style.display = (isMyTurn && phase === 'uno' && !iFinished) ? 'inline-block' : 'none';
    if (g.unoPenaltyAccum > 0) {
      udrawBtn.textContent = `ペナルティ ${g.unoPenaltyAccum} 枚引く`;
      udrawBtn.classList.add('penalty');
    } else {
      udrawBtn.textContent = 'UNOを1枚引く';
      udrawBtn.classList.remove('penalty');
    }
  }

  const unoBtn = document.getElementById('uno-btn');
  if (unoBtn) {
    const showUno = !iFinished && !myUnoDone && isMyTurn && phase === 'uno'
      && myUno.length <= 2 && !(g.unoSaid && g.unoSaid[state.myId]);
    unoBtn.style.display = showUno ? 'inline-block' : 'none';
  }

  const parentColorBtn = document.getElementById('parent-color-btn');
  if (parentColorBtn) {
    parentColorBtn.style.display = (isMyTurn && phase === 'uno' && g.hasParent === state.myId) ? 'block' : 'none';
  }
}

function _renderLog(room) {
  const logEl = document.getElementById('glog');
  const logs = room.log || [];
  logEl.innerHTML = logs.slice(-6).map(l => `<div class="log-entry">${l}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

// ----------------------------------------
// トランプ手札の描画
// ----------------------------------------
export function renderTrumpHand(hand, canAct, g, iFinished, myTrumpDone) {
  const el = document.getElementById('my-trump-hand'); if (!el) return;
  const cntEl = document.getElementById('trump-cnt'); if (cntEl) cntEl.textContent = hand.length;

  if (iFinished) { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myTrumpDone) { el.innerHTML = `<div class="hand-done">✅ トランプ出し切り！UNOフェイズのみ</div>`; return; }

  const selectedIds = window._selectedTrumpIds || [];

  el.innerHTML = '';
  hand.forEach(card => {
    const canPlay = canAct && window.trumpCanPlayCard(card, g.trumpField, selectedIds);
    const isRed = card.s === '♥' || card.s === '♦';
    const isSelected = selectedIds.includes(card.id);
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
export function renderUnoHand(hand, canAct, g, iFinished, myUnoDone) {
  const el = document.getElementById('my-uno-hand'); if (!el) return;
  const cntEl = document.getElementById('uno-cnt-my'); if (cntEl) cntEl.textContent = hand.length;

  if (iFinished) { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myUnoDone) { el.innerHTML = `<div class="hand-done">✅ UNO出し切り！トランプフェイズのみ</div>`; return; }

  const selectedIdx = window._selectedUnoIdx;
  const topUno = g.unoDiscardPile && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1] : null;

  el.innerHTML = '';
  hand.forEach((card, idx) => {
    // unoCanPlay の判定は ui-input.js が window.unoCanPlayCard として公開する
    const canPlay = canAct && topUno && typeof window.unoCanPlayCard === 'function'
      ? window.unoCanPlayCard(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum)
      : false;
    const isSelected = idx === selectedIdx;
    const div = document.createElement('div');
    div.className = `hcd ${unoCardColorClass(card)}${!canPlay && !isSelected ? ' off' : ''}${isSelected ? ' selected' : ''}`;
    div.dataset.cardIdx = idx;
    div.innerHTML = `<span class="hs">${card.v}</span>${card.v}<span class="hs br">${card.v}</span>`;
    if (canPlay || isSelected) div.onclick = () => window.selectUnoCard(idx);
    el.appendChild(div);
  });
}

// ----------------------------------------
// リザルト画面の描画
// ----------------------------------------
export function renderResult(room) {
  const g = room.game;
  const rankings = (g && g.rankings) || [];
  const rlist = document.getElementById('rlist');
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
  const ric = document.getElementById('ric');
  const rtit = document.getElementById('rtit');
  if (myRankIdx === 0) { ric.textContent = '👑'; rtit.textContent = 'あなたが1位！'; }
  else if (myRankIdx !== -1) { ric.textContent = '🏁'; rtit.textContent = `${myRankIdx + 1}位でゴール！`; }
  else { ric.textContent = '😅'; rtit.textContent = 'ゲーム終了！'; }

  const resBtn = document.getElementById('res-back-btn');
  if (state.myId === room.host) {
    resBtn.style.display = 'block';
    resBtn.disabled = false;
    resBtn.textContent = 'もう一度遊ぶ（ロビーへ）';
  } else {
    resBtn.style.display = 'block';
    resBtn.disabled = true;
    resBtn.textContent = 'ホストが再開するのを待っています...';
  }
}

// ----------------------------------------
// リアクションフィードバック
// ----------------------------------------
export function flashReactionBtn(emoji) {
  document.querySelectorAll('.react-btn').forEach(b => {
    if (b.dataset.emoji === emoji) {
      b.classList.add('reacted');
      showSelfReaction(emoji);
      setTimeout(() => b.classList.remove('reacted'), 1500);
    }
  });
}

export function showSelfReaction(emoji) {
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
