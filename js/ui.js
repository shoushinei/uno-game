// ========================================
// UI 描画・操作関数（大富豪×UNO 融合版）
// ========================================
import { state } from "./state.js";
import { AVATAR_COLORS, unoCardColorClass, trumpCanPlay, unoCanPlay } from "./game-logic.js";

// ----------------------------------------
// 画面切り替え（元のまま流用）
// ----------------------------------------
export function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("s-" + id).classList.add("active");
}

// ----------------------------------------
// メッセージ表示（元のまま流用）
// ----------------------------------------
export function setHomeMsg(text) {
  document.getElementById("hm").textContent = text;
}
export function setLobbyMsg(text) {
  document.getElementById("lm").textContent = text;
}
export function setStatus(msg, type) {
  const el = document.getElementById("fb-status");
  el.textContent = msg;
  el.className = "msg" + (type ? " " + type : "");
}
export function dbg(msg, isErr = false) {
  const el = document.getElementById("dbg-log");
  if (!el) return;
  const d = new Date();
  const t = `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  el.innerHTML += `<div style="color:${isErr ? "#e74c3c" : "inherit"}">[${t}] ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}
export function setLoading(btnId, loading, text) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = loading;
  b.textContent = loading ? text + "..." : text;
}

// ----------------------------------------
// ロビー画面の描画（最小人数を3人に変更のみ）
// ----------------------------------------
export function renderLobby(room) {
  const players = room.players || [];
  const pl = document.getElementById("lpl");
  pl.innerHTML = "";

  let allReady = true;
  players.forEach((p, i) => {
    const el = document.createElement("div");
    el.className = "pi";
    let tags = "";
    if (p.id === state.myId) tags += '<span class="tag you">あなた</span>';
    if (p.id === room.host)  tags += '<span class="tag host">ホスト</span>';
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

  const sb = document.getElementById("sbtn");
  const rb = document.getElementById("rbtn");

  if (state.myId === room.host) {
    sb.style.display = "block";
    rb.style.display = "none";
    if (players.length < 3) {
      sb.disabled = true;
      setLobbyMsg(`あと ${3 - players.length} 人必要です（最低3人）`);
    } else if (!allReady) {
      sb.disabled = true;
      setLobbyMsg("全員が準備完了するのを待っています...");
    } else {
      sb.disabled = false;
      setLobbyMsg(`全員準備完了！ゲームを開始できます (${players.length}人)`);
    }
  } else {
    sb.style.display = "none";
    rb.style.display = "block";
    const me = players.find((p) => p.id === state.myId);
    if (me && me.ready) {
      rb.textContent = "準備をキャンセル";
      rb.className = "btn";
      setLobbyMsg("ホストがゲームを開始するまで待ってね...");
    } else {
      rb.textContent = "準備完了！";
      rb.className = "btn red";
      setLobbyMsg("準備ができたらボタンを押してね");
    }
  }
}

// ----------------------------------------
// ゲーム画面の描画（融合ゲーム専用）
// ----------------------------------------
export function renderGame(room) {
  const g        = room.game;
  if (!g) return;
  const players   = room.players || [];
  const reactions = room.reactions || {};
  const curId     = g.order[g.ci];
  const isMyTurn  = curId === state.myId;
  const phase     = g.phase || "trump";
  const myRankIdx = (g.rankings || []).findIndex(r => r.id === state.myId);
  const iFinished = myRankIdx !== -1;

  const myTrump     = (g.trumpHands && g.trumpHands[state.myId]) || [];
  const myUno       = (g.unoHands   && g.unoHands[state.myId])   || [];
  const myTrumpDone = myTrump.length === 0;
  const myUnoDone   = myUno.length === 0;

  // ---- ターンバナー ----
  const tb = document.getElementById("tbnr");
  if (iFinished) {
    tb.textContent = `🏁 上がり確定（${myRankIdx + 1}位・観戦中）`;
    tb.className = "tb finished";
  } else if (isMyTurn) {
    tb.textContent = phase === "trump"
      ? "あなたのターン【①トランプフェイズ】"
      : "あなたのターン【②UNOフェイズ】";
    tb.className = "tb myturn";
  } else {
    const cp = players.find(p => p.id === curId);
    tb.textContent = `${cp ? cp.name : "?"}のターン【${phase === "trump" ? "①トランプ" : "②UNO"}】`;
    tb.className = "tb wait";
  }

  // ---- フェイズインジケーター ----
  const pi = document.getElementById("phase-indicator");
  if (pi) {
    pi.innerHTML = `
      <span class="${phase === "trump" ? "phase-active" : "phase-idle"}">① 🃏 トランプ</span>
      <span class="phase-arrow">→</span>
      <span class="${phase === "uno" ? "phase-active" : "phase-idle"}">② 🎴 UNO</span>
    `;
  }

  // ---- 他プレイヤー ----
  const opl = document.getElementById("opl");
  opl.innerHTML = "";
  players.filter(p => p.id !== state.myId).forEach(p => {
    const tc    = (g.trumpHands && g.trumpHands[p.id]) ? g.trumpHands[p.id].length : 0;
    const uc    = (g.unoHands   && g.unoHands[p.id])   ? g.unoHands[p.id].length   : 0;
    const active  = p.id === curId && g.order.includes(p.id);
    const rIdx    = (g.rankings || []).findIndex(r => r.id === p.id);
    const react   = reactions[p.id];
    const reactHtml = (react && Date.now() - react.ts < 4000)
      ? `<div class="react-badge">${react.emoji}</div>` : "";
    const el = document.createElement("div");
    el.className = "op" + (active ? " cur" : "");
    el.innerHTML = `
      ${reactHtml}
      <div class="on">${p.name}</div>
      ${rIdx !== -1
        ? `<div class="oc finish-badge">🏁${rIdx+1}位</div>`
        : `<div class="oc"><div class="trump-cnt">🃏${tc}枚</div><div class="uno-cnt">🎴${uc}枚</div></div>`
      }
    `;
    opl.appendChild(el);
  });

  // ---- トランプの場 ----
  const tfEl = document.getElementById("trump-field");
  if (tfEl) {
    if (g.trumpField) {
      const c = g.trumpField;
      const isRed = c.s === "♥" || c.s === "♦";
      tfEl.innerHTML = `<div class="trump-card${isRed ? " red" : ""}">
        <span class="ts">${c.s}</span><span class="tv">${c.v}</span>
      </div>`;
    } else {
      tfEl.innerHTML = `<div class="trump-empty">場は空<br><small>何でも出せる</small></div>`;
    }
  }

  // ---- 親バッジ ----
  const parentBadge = document.getElementById("parent-badge");
  if (parentBadge) {
    if (g.hasParent) {
      const pName = players.find(p => p.id === g.hasParent)?.name || "?";
      const isMeParent = g.hasParent === state.myId;
      parentBadge.textContent = `👑 親: ${pName}${isMeParent ? "（あなた）" : ""}`;
      parentBadge.style.display = "inline-block";
    } else {
      parentBadge.style.display = "none";
    }
  }

  // ---- UNOの場 ----
  const topUno = g.unoDiscardPile && g.unoDiscardPile.length > 0
    ? g.unoDiscardPile[g.unoDiscardPile.length - 1] : null;
  if (topUno) {
    const ufEl = document.getElementById("uno-field");
    if (ufEl) {
      ufEl.className = "uno-field-card tc " + unoCardColorClass(topUno);
      document.getElementById("uf-val").textContent  = topUno.v;
      document.getElementById("uf-sym").textContent  = topUno.v;
      document.getElementById("uf-sym2").textContent = topUno.v;
    }
  }

  // ---- 現在色バッジ ----
  const ccEl = document.getElementById("current-color");
  if (ccEl) {
    const colorMap = { red:"🔴 赤", blue:"🔵 青", green:"🟢 緑", yellow:"🟡 黄" };
    ccEl.textContent = "現在の色: " + (colorMap[g.unoCurrentColor] || g.unoCurrentColor);
    ccEl.className   = "current-color-badge cc-" + g.unoCurrentColor;
  }

  // ---- 累積ドロー警告 ----
  const penEl = document.getElementById("penalty-warn");
  if (penEl) {
    if (g.unoPenaltyAccum > 0) {
      penEl.textContent = `⚠️ +${g.unoPenaltyAccum} 累積中！同種で返すかまとめて引く`;
      penEl.style.display = "block";
    } else {
      penEl.style.display = "none";
    }
  }

  // ---- 自分のトランプ手札 ----
  renderTrumpHand(myTrump, isMyTurn && phase === "trump", g, iFinished, myTrumpDone);

  // ---- 自分のUNO手札 ----
  renderUnoHand(myUno, isMyTurn && phase === "uno", g, topUno, iFinished, myUnoDone);

  // ---- アクションボタン表示制御 ----
  // トランプフェイズ
  const tpassBtn    = document.getElementById("trump-pass-btn");
  const tskipBtn    = document.getElementById("trump-skip-btn");
  if (tpassBtn) tpassBtn.style.display = (isMyTurn && phase === "trump" && !iFinished && !myTrumpDone) ? "inline-block" : "none";
  if (tskipBtn) tskipBtn.style.display = (isMyTurn && phase === "trump" && !iFinished && myTrumpDone)  ? "inline-block" : "none";

  // UNOフェイズ
  const udrawBtn = document.getElementById("uno-draw-btn");
  if (udrawBtn) {
    udrawBtn.style.display = (isMyTurn && phase === "uno" && !iFinished) ? "inline-block" : "none";
    if (g.unoPenaltyAccum > 0) {
      udrawBtn.textContent = `ペナルティ ${g.unoPenaltyAccum} 枚引く`;
      udrawBtn.classList.add("penalty");
    } else {
      udrawBtn.textContent = "UNOを1枚引く";
      udrawBtn.classList.remove("penalty");
    }
  }

  // UNO宣言ボタン
  const unoBtn = document.getElementById("uno-btn");
  if (unoBtn) {
    const showUno = !iFinished && !myUnoDone && isMyTurn && phase === "uno"
      && myUno.length <= 2 && !(g.unoSaid && g.unoSaid[state.myId]);
    unoBtn.style.display = showUno ? "inline-block" : "none";
  }

  // 親カラー変更ボタン
  const parentColorBtn = document.getElementById("parent-color-btn");
  if (parentColorBtn) {
    parentColorBtn.style.display = (isMyTurn && phase === "uno" && g.hasParent === state.myId) ? "block" : "none";
  }

  // カラーピッカーを閉じる
  document.getElementById("cpick")?.classList.remove("show");

  // ---- ログ ----
  const logEl = document.getElementById("glog");
  const logs  = room.log || [];
  logEl.innerHTML = logs.slice(-6).map(l => `<div class="log-entry">${l}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;
}

function renderTrumpHand(hand, canAct, g, iFinished, myTrumpDone) {
  const el    = document.getElementById("my-trump-hand"); if (!el) return;
  const cntEl = document.getElementById("trump-cnt");     if (cntEl) cntEl.textContent = hand.length;

  if (iFinished) { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myTrumpDone) { el.innerHTML = `<div class="hand-done">✅ トランプ出し切り！UNOフェイズのみ</div>`; return; }

  // 現在の選択状態を取得（app.js側で公開している変数）
  const selectedIds = window._selectedTrumpIds || [];

  el.innerHTML = "";
  hand.forEach(card => {
    // 選択0枚時は通常判定、1枚以上選択中は同ランクのみ追加選択可
    const canPlay = canAct && window.trumpCanPlayCard(card, g.trumpField, selectedIds);
    const isRed     = card.s === "♥" || card.s === "♦";
    const isSelected = selectedIds.includes(card.id);
    const div   = document.createElement("div");
    div.className = `trump-hand-card${isRed ? " red" : ""}${!canPlay && !isSelected ? " off" : ""}${isSelected ? " selected" : ""}`;
    div.dataset.cardId  = card.id;
    div.dataset.canPlay = canPlay ? "1" : "0";
    div.innerHTML = `<span class="ts">${card.s}</span><span class="tv">${card.v}</span>`;
    // 出せるカードと選択済みカード（解除用）のみクリック可能
    if (canPlay || isSelected) div.onclick = () => window.selectTrumpCard(card.id);
    el.appendChild(div);
  });
}

function renderUnoHand(hand, canAct, g, topUno, iFinished, myUnoDone) {
  const el    = document.getElementById("my-uno-hand"); if (!el) return;
  const cntEl = document.getElementById("uno-cnt-my"); if (cntEl) cntEl.textContent = hand.length;

  if (iFinished)  { el.innerHTML = `<div class="hand-done">🏁 上がり（観戦中）</div>`; return; }
  if (myUnoDone)  { el.innerHTML = `<div class="hand-done">✅ UNO出し切り！トランプフェイズのみ</div>`; return; }

  // 現在の選択状態を取得（app.js側で公開している変数）
  const selectedIdx = window._selectedUnoIdx;

  el.innerHTML = "";
  hand.forEach((card, idx) => {
    const canPlay    = canAct && topUno && unoCanPlay(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum);
    const isSelected = idx === selectedIdx;
    const div = document.createElement("div");
    div.className = `hcd ${unoCardColorClass(card)}${!canPlay && !isSelected ? " off" : ""}${isSelected ? " selected" : ""}`;
    div.dataset.cardIdx = idx;
    div.innerHTML = `<span class="hs">${card.v}</span>${card.v}<span class="hs br">${card.v}</span>`;
    // 出せるカードと選択済みカード（解除用）のみクリック可能
    if (canPlay || isSelected) div.onclick = () => window.selectUnoCard(idx);
    el.appendChild(div);
  });
}

// ----------------------------------------
// リザルト画面の描画（元のまま流用）
// ----------------------------------------
export function renderResult(room) {
  const g        = room.game;
  const rankings = (g && g.rankings) || [];
  const rlist    = document.getElementById("rlist");
  rlist.innerHTML = "";

  rankings.forEach((r, idx) => {
    const medal = ["🥇","🥈","🥉"][idx] || `${idx + 1}位`;
    const isMe  = r.id === state.myId
      ? '<span class="tag you" style="margin:0">あなた</span>' : "";
    const el    = document.createElement("div");
    el.className = "rank-row" + (r.id === state.myId ? " rank-me" : "");
    el.innerHTML = `<span class="rank-medal">${medal}</span><span class="rank-name">${r.name}</span>${isMe}`;
    rlist.appendChild(el);
  });

  const myRankIdx = rankings.findIndex(r => r.id === state.myId);
  const ric  = document.getElementById("ric");
  const rtit = document.getElementById("rtit");
  if (myRankIdx === 0)       { ric.textContent = "👑"; rtit.textContent = "あなたが1位！"; }
  else if (myRankIdx !== -1) { ric.textContent = "🏁"; rtit.textContent = `${myRankIdx + 1}位でゴール！`; }
  else                        { ric.textContent = "😅"; rtit.textContent = "ゲーム終了！"; }

  const resBtn = document.getElementById("res-back-btn");
  if (state.myId === room.host) {
    resBtn.style.display = "block";
    resBtn.disabled      = false;
    resBtn.textContent   = "もう一度遊ぶ（ロビーへ）";
  } else {
    resBtn.style.display = "block";
    resBtn.disabled      = true;
    resBtn.textContent   = "ホストが再開するのを待っています...";
  }
}

// ----------------------------------------
// リアクションフィードバック（元のまま流用）
// ----------------------------------------
export function flashReactionBtn(emoji) {
  document.querySelectorAll(".react-btn").forEach(b => {
    if (b.dataset.emoji === emoji) {
      b.classList.add("reacted");
      showSelfReaction(emoji);
      setTimeout(() => b.classList.remove("reacted"), 1500);
    }
  });
}

export function showSelfReaction(emoji) {
  let popup = document.getElementById("self-react-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "self-react-popup";
    document.body.appendChild(popup);
  }
  popup.textContent = emoji;
  popup.classList.remove("pop-anim");
  void popup.offsetWidth;
  popup.classList.add("pop-anim");
}
