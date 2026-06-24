// ========================================
// UNO ゲームロジック（純粋関数・副作用なし）
// ========================================

export const COLORS = ["red", "blue", "green", "yellow"];
export const COLOR_NAMES = { red: "赤", blue: "青", green: "緑", yellow: "黄" };
export const AVATAR_COLORS = ["#e74c3c", "#2980b9", "#27ae60", "#f39c12", "#8e44ad"];

// ----------------------------------------
// デッキ生成・シャッフル
// ----------------------------------------
export function buildDeck() {
  const d = [];
  COLORS.forEach((c) => {
    d.push({ c, t: "num", v: "0" });
    for (let i = 1; i <= 9; i++) {
      d.push({ c, t: "num", v: String(i) });
      d.push({ c, t: "num", v: String(i) });
    }
    [
      { t: "skip", v: "⊘" },
      { t: "rev",  v: "⇄" },
      { t: "d2",   v: "+2" },
    ].forEach((x) => {
      d.push({ c, t: x.t, v: x.v });
      d.push({ c, t: x.t, v: x.v });
    });
  });
  for (let i = 0; i < 4; i++) {
    d.push({ c: "w", t: "w",  v: "W" });
    d.push({ c: "w", t: "w4", v: "+4" });
  }
  return d;
}

export function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ----------------------------------------
// カードの有効判定
// ----------------------------------------
export function canPlay(card, top, currentColor, penaltyCards, pendingSkip) {
  // ドロー累積中：同種のドローカードのみ可
  if (penaltyCards > 0) {
    if (top.t === "d2"  && card.t === "d2")  return true;
    if (top.t === "w4"  && card.t === "w4")  return true;
    return false;
  }
  // スキップ保留中：スキップカードのみ可
  if (pendingSkip) {
    return card.t === "skip";
  }
  if (card.t === "w" || card.t === "w4") return true;
  if (card.c === currentColor)            return true;
  if (card.t === "num" && top.t === "num" && card.v === top.v) return true;
  if (card.t !== "num" && card.t === top.t)                    return true;
  return false;
}

// ----------------------------------------
// カードの CSS クラス名
// ----------------------------------------
export function cardColorClass(card) {
  return card.t === "w" || card.t === "w4" ? "w" : card.c[0];
}

// ----------------------------------------
// ゲーム初期化
// ----------------------------------------
export function initGame(players) {
  const deck  = shuffle(buildDeck());
  const hands = {};
  players.forEach((p) => { hands[p.id] = []; });
  for (let i = 0; i < 7; i++) {
    players.forEach((p) => { hands[p.id].push(deck.pop()); });
  }
  let top;
  do { top = deck.pop(); } while (top.t === "w" || top.t === "w4");

  const order = shuffle(players.map((p) => p.id));

  return {
    deck,
    discard:      [top],
    hands,
    cc:           top.c,   // current color
    dir:          1,        // 1: 正順 / -1: 逆順
    ci:           0,        // current player index in order[]
    order,
    unoSaid:      {},
    penaltyCards: 0,
    pendingSkip:  false,
    rankings:     [],
  };
}

// ----------------------------------------
// 山札リシャッフル（捨て札→山札）
// ----------------------------------------
export function reshuffleInline(g) {
  const top  = g.discard[g.discard.length - 1];
  g.deck     = shuffle(g.discard.slice(0, g.discard.length - 1));
  g.discard  = [top];
}

// ----------------------------------------
// カードを出す処理（状態を直接変更して返す）
// ----------------------------------------
export function applyPlayCard(g, playerId, cardIdx, chosenColor, playerName) {
  const myHand = [...(g.hands[playerId] || [])];
  const card   = myHand.splice(cardIdx, 1)[0];
  g.hands[playerId] = myHand;
  g.discard = [...g.discard, card];

  if (card.t === "w" || card.t === "w4") {
    g.cc = chosenColor || "red";
  } else {
    g.cc = card.c;
  }

  let extra = "";
  const n   = g.order.length;
  let   nxt = (g.ci + g.dir + n) % n;

  if (card.t === "skip") {
    g.pendingSkip = true;
    extra = "スキップ！";
  } else if (card.t === "rev") {
    g.dir  *= -1;
    nxt     = (g.ci + g.dir + n) % n;
    extra   = "リバース！";
  } else if (card.t === "d2") {
    g.penaltyCards = (g.penaltyCards || 0) + 2;
    extra = "+2！";
  } else if (card.t === "w4") {
    g.penaltyCards = (g.penaltyCards || 0) + 4;
    extra = `ワイルド+4！${COLOR_NAMES[chosenColor]}色に変更`;
  } else if (card.t === "w") {
    extra = `ワイルド！${COLOR_NAMES[chosenColor]}色に変更`;
  }

  if (card.t !== "skip") g.pendingSkip   = false;
  if (card.t !== "d2" && card.t !== "w4") g.penaltyCards = 0;

  // UNO 忘れペナルティ
  if (!g.unoSaid) g.unoSaid = {};
  if (myHand.length === 1 && !g.unoSaid[playerId]) {
    const dk = [...g.deck];
    const mh = [...myHand];
    for (let i = 0; i < 2; i++) {
      if (!dk.length) reshuffleInline(g);
      if (dk.length) mh.push(dk.pop());
    }
    g.hands[playerId] = mh;
    g.deck = dk;
    extra += "（UNO忘れ！2枚引き）";
  }
  if (myHand.length !== 1) delete g.unoSaid[playerId];

  const nextPlayerId = g.order[nxt];

  // ゴール判定
  if (!g.rankings) g.rankings = [];
  if (myHand.length === 0) {
    if (!g.rankings.some((r) => r.id === playerId)) {
      g.rankings.push({ id: playerId, name: playerName });
    }
    g.order = g.order.filter((id) => id !== playerId);
  }

  // 次の手番
  g.ci = g.order.indexOf(nextPlayerId);
  if (g.ci === -1) g.ci = 0;

  const logMsg = `${playerName}が[${card.v}]を出した${extra ? " " + extra : ""}`;
  return { g, logMsg, isFinished: g.order.length <= 1 };
}
