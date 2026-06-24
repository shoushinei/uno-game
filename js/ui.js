// ========================================
// UI 描画・操作関数
// ========================================
import { state } from "./state.js";
import { AVATAR_COLORS, cardColorClass, canPlay } from "./game-logic.js";

// ----------------------------------------
// 画面切り替え
// ----------------------------------------
export function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById("s-" + id).classList.add("active");
}

// ----------------------------------------
// メッセージ表示
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

// ----------------------------------------
// ボタンのローディング状態
// ----------------------------------------
export function setLoading(btnId, loading, text) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.disabled = loading;
  b.textContent = loading ? text + "..." : text;
}

// ----------------------------------------
// ロビー画面の描画
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
    if (players.length < 2) {
      sb.disabled = true;
      setLobbyMsg(`あと ${2 - players.length} 人必要です`);
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
// ゲーム画面の描画
// ----------------------------------------
export function renderGame(room) {
  const g       = room.game;
  if (!g) return;
  const players  = room.players || [];
  const reactions = room.reactions || {};
  const top      = g.discard[g.discard.length - 1];
  const curId    = g.order[g.ci];
  const isMyTurn = curId === state.myId;
  const myHand   = (g.hands && g.hands[state.myId]) || [];
  const myRankIdx = (g.rankings || []).findIndex((r) => r.id === state.myId);

  // ターンバナー
  document.getElementById("diric").textContent = g.dir === 1 ? "↻" : "↺";
  const tb = document.getElementById("tbnr");
  if (myRankIdx !== -1) {
    tb.textContent = `${myRankIdx + 1}位でゴール確定（観戦中）`;
    tb.className = "tb finished";
  } else if (isMyTurn) {
    tb.textContent = "あなたのターン！";
    tb.className = "tb myturn";
  } else {
    const cp = players.find((p) => p.id === curId);
    tb.textContent = (cp ? cp.name : "?") + "のターン";
    tb.className = "tb wait";
  }

  // 場のカード
  const tc = document.getElementById("topc");
  tc.className = "tc " + (top.t === "w" || top.t === "w4" ? "w" : g.cc[0]);
  document.getElementById("tval").textContent  = top.v;
  document.getElementById("tsym").textContent  = top.v;
  document.getElementById("tsym2").textContent = top.v;

  // 他プレイヤー表示
  const opl = document.getElementById("opl");
  opl.innerHTML = "";
  players.filter((p) => p.id !== state.myId).forEach((p) => {
    const isPlaying = g.order.includes(p.id);
    let cntText;
    if (isPlaying) {
      const cnt = (g.hands && g.hands[p.id]) ? g.hands[p.id].length : 0;
      cntText = `${cnt}枚`;
    } else {
      const rIdx = (g.rankings || []).findIndex((r) => r.id === p.id);
      cntText = rIdx !== -1 ? `🎉 ${rIdx + 1}位` : "上がり";
    }
    const active = isPlaying && p.id === curId;
    const el = document.createElement("div");
    el.className = "op" + (active ? " cur" : "");
    el.dataset.playerId = p.id;

    // リアクションバッジ
    const react = reactions[p.id];
    const reactHtml = (react && Date.now() - react.ts < 4000)
      ? `<div class="react-badge">${react.emoji}</div>`
      : "";

    el.innerHTML = `
      ${reactHtml}
      <div class="on">${p.name}</div>
      <div class="oc">${cntText}</div>
    `;
    opl.appendChild(el);
  });

  // 自分の手札
  document.getElementById("hcnt").textContent = myHand.length;
  const hcs = document.getElementById("hcs");
  hcs.innerHTML = "";
  myHand.forEach((card, idx) => {
    const ok = myRankIdx === -1 && isMyTurn &&
      canPlay(card, top, g.cc, g.penaltyCards, g.pendingSkip);
    const el = document.createElement("div");
    el.className = "hcd " + cardColorClass(card) + (ok ? "" : " off");
    el.innerHTML = `<span class="hs">${card.v}</span>${card.v}<span class="hs br">${card.v}</span>`;
    if (ok) el.onclick = () => window._selectCard(idx);
    hcs.appendChild(el);
  });

  // UNOボタン
  const showUno = myRankIdx === -1 && myHand.length <= 2 && !(g.unoSaid && g.unoSaid[state.myId]);
  document.getElementById("unobtn").style.display = showUno ? "block" : "none";

  // 警告メッセージ
  const gm = document.getElementById("gm");
  if (g.penaltyCards > 0) {
    gm.textContent = `⚠️ ドロー累積中！ペナルティ ${g.penaltyCards} 枚！`;
    gm.classList.add("show");
  } else if (g.pendingSkip) {
    gm.textContent = "⚠️ スキップ発動中！スキップカードで返せます！";
    gm.classList.add("show");
  } else {
    gm.textContent = "";
    gm.classList.remove("show");
  }

  // カードを引くボタン
  const drawBtn = document.getElementById("draw-btn");
  if (myRankIdx !== -1) {
    drawBtn.style.display = "none";
  } else {
    drawBtn.style.display = "block";
    if (isMyTurn && g.penaltyCards > 0) {
      drawBtn.textContent = `ペナルティを引く (${g.penaltyCards}枚)`;
      drawBtn.classList.add("penalty");
    } else if (isMyTurn && g.pendingSkip) {
      drawBtn.textContent = "スキップを受け入れる（パス）";
      drawBtn.classList.remove("penalty");
    } else {
      drawBtn.textContent = "カードを引く";
      drawBtn.classList.remove("penalty");
    }
  }

  // ゲームログ
  const logEl = document.getElementById("glog");
  const logs  = room.log || [];
  logEl.innerHTML = logs.slice(-6).map((l) => `<div class="log-entry">${l}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;

  // カラーピッカー閉じる
  document.getElementById("cpick").classList.remove("show");
}

// ----------------------------------------
// リザルト画面の描画
// ----------------------------------------
export function renderResult(room) {
  const g        = room.game;
  const rankings = (g && g.rankings) || [];
  const rlist    = document.getElementById("rlist");
  rlist.innerHTML = "";

  rankings.forEach((r, idx) => {
    const medal = ["🥇","🥈","🥉"][idx] || `${idx + 1}位`;
    const isMe  = r.id === state.myId ? '<span class="tag you" style="margin:0">あなた</span>' : "";
    const el    = document.createElement("div");
    el.className = "rank-row" + (r.id === state.myId ? " rank-me" : "");
    el.innerHTML = `<span class="rank-medal">${medal}</span><span class="rank-name">${r.name}</span>${isMe}`;
    rlist.appendChild(el);
  });

  const myRankIdx = rankings.findIndex((r) => r.id === state.myId);
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
// リアクションボタンのフィードバック
// ----------------------------------------
export function flashReactionBtn(emoji) {
  // 押したボタンを一時的にハイライト
  const btns = document.querySelectorAll(".react-btn");
  btns.forEach((b) => {
    if (b.dataset.emoji === emoji) {
      b.classList.add("reacted");
      // 自分のリアクション表示（画面中央にポップアップ）
      showSelfReaction(emoji);
      setTimeout(() => b.classList.remove("reacted"), 1500);
    }
  });
}

// ----------------------------------------
// 自分のリアクションを画面中央にポップ表示
// ----------------------------------------
export function showSelfReaction(emoji) {
  let popup = document.getElementById("self-react-popup");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "self-react-popup";
    document.body.appendChild(popup);
  }
  popup.textContent = emoji;
  popup.classList.remove("pop-anim");
  // reflow をトリガーしてアニメーションをリセット
  void popup.offsetWidth;
  popup.classList.add("pop-anim");
}
