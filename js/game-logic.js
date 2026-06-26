// =============================================
// 大富豪×UNO 融合ゲーム ロジック（複数枚出し対応版）
// =============================================

// ---- UNO ----
export const UNO_COLORS = ['red','blue','green','yellow'];
export const UNO_COLOR_NAMES = { red:'赤', blue:'青', green:'緑', yellow:'黄' };
export const AVATAR_COLORS = ['#e74c3c','#2980b9','#27ae60','#f39c12','#8e44ad'];

export function buildUnoDeck() {
  const d = [];
  UNO_COLORS.forEach(c => {
    d.push({ c, t:'num', v:'0' });
    for (let i=1;i<=9;i++) { d.push({c,t:'num',v:''+i}); d.push({c,t:'num',v:''+i}); }
    [{t:'skip',v:'⊘'},{t:'rev',v:'⇄'},{t:'d2',v:'+2'}].forEach(x => {
      d.push({c,t:x.t,v:x.v}); d.push({c,t:x.t,v:x.v});
    });
  });
  for (let i=0;i<4;i++) { d.push({c:'w',t:'w',v:'W'}); d.push({c:'w',t:'w4',v:'+4'}); }
  return d;
}

export function unoCanPlay(card, top, currentColor, penaltyAccum) {
  if (penaltyAccum > 0) {
    return (top.t==='d2' && card.t==='d2') || (top.t==='w4' && card.t==='w4');
  }
  if (card.t==='w' || card.t==='w4') return true;
  if (card.c === currentColor) return true;
  if (card.t==='num' && top.t==='num' && card.v===top.v) return true;
  if (card.t!=='num' && card.t===top.t) return true;
  return false;
}

export function unoCardColorClass(card) {
  return (card.t==='w'||card.t==='w4') ? 'w' : card.c[0];
}

// ---- トランプ ----
const TRUMP_SUITS = ['♠','♥','♦','♣'];
const TRUMP_NUMS  = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const TRUMP_STRENGTH = {'3':1,'4':2,'5':3,'6':4,'7':5,'8':6,'9':7,'10':8,'J':9,'Q':10,'K':11,'A':12,'2':13,'JOKER':14};

export function buildTrumpDeck() {
  const d = [];
  TRUMP_SUITS.forEach(s => TRUMP_NUMS.forEach(v => d.push({ s, v, id:`${s}${v}` })));
  d.push({ s:'🃏', v:'JOKER', id:'JOKER' });
  return d;
}

export function trumpStrength(card) {
  return TRUMP_STRENGTH[card.v] ?? 0;
}

/**
 * ★変更箇所①: トランプの複数枚出し判定
 */
export function trumpCanPlay(selectedCards, fieldCards) {
  if (!Array.isArray(selectedCards) || selectedCards.length === 0) return false;

  // 1. 選択されたカードがすべて同じ数字かチェック
  const nonJokerCards = selectedCards.filter(c => c.v !== 'JOKER');
  let targetValue = 'JOKER';
  if (nonJokerCards.length > 0) {
    targetValue = nonJokerCards[0].v;
    if (!nonJokerCards.every(c => c.v === targetValue)) return false;
  }

  const selectedPower = TRUMP_STRENGTH[targetValue] ?? 0;
  const fCards = Array.isArray(fieldCards) ? fieldCards : [];

  // 場が空なら、同じ数字であれば何枚でも出せる
  if (fCards.length === 0) return true;

  // 場にカードがあるなら、「枚数が同じ」かつ「場のカードより強い」必要がある
  if (selectedCards.length !== fCards.length) return false;

  const nonJokerField = fCards.filter(c => c.v !== 'JOKER');
  const fieldValue = nonJokerField.length > 0 ? nonJokerField[0].v : 'JOKER';
  const fieldPower = TRUMP_STRENGTH[fieldValue] ?? 0;

  return selectedPower > fieldPower;
}

export function sortTrumpHand(hand) {
  return [...hand].sort((a,b) => trumpStrength(a) - trumpStrength(b));
}

export function shuffle(a) {
  const arr = [...a];
  for (let i=arr.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

// =============================================
// ゲーム初期化
// =============================================
export function initFusionGame(players) {
  const trumpDeck = shuffle(buildTrumpDeck());
  const unoDeck   = shuffle(buildUnoDeck());

  const trumpHands = {};
  const unoHands   = {};
  players.forEach(p => { trumpHands[p.id]=[]; unoHands[p.id]=[]; });

  let di=0;
  while (di < trumpDeck.length) {
    players.forEach(p => { if(di<trumpDeck.length) trumpHands[p.id].push(trumpDeck[di++]); });
  }
  players.forEach(p => { trumpHands[p.id] = sortTrumpHand(trumpHands[p.id]); });

  const unoPerPlayer = 7;
  players.forEach((p,i) => {
    unoHands[p.id] = unoDeck.slice(i*unoPerPlayer, (i+1)*unoPerPlayer);
  });
  const unoDrawPile = unoDeck.slice(unoPerPlayer*players.length);

  let unoFieldCard;
  const remaining = [...unoDrawPile];
  const extraDiscard = [];
  while (remaining.length > 0) {
    const card = remaining.pop();
    if (card.t !== 'w' && card.t !== 'w4') { unoFieldCard = card; break; }
    extraDiscard.push(card);
  }
  const finalDrawPile = [...remaining, ...extraDiscard];

  const order = players.map(p=>p.id);
  const d3holder = players.find(p => trumpHands[p.id].some(c=>c.s==='♦'&&c.v==='3'));
  const startCI = d3holder ? order.indexOf(d3holder.id) : 0;

  return {
    order,
    ci:        startCI,
    dir:       1,
    phase:     'trump',
    rankings:  [],
    trumpHands,
    trumpField:  [], // ★変更箇所②: null から空配列 [] に変更
    hasParent:   null,
    unoHands,
    unoDrawPile:    finalDrawPile,
    unoDiscardPile: unoFieldCard ? [unoFieldCard] : [],
    unoCurrentColor: unoFieldCard ? unoFieldCard.c : 'red',
    unoPenaltyAccum: 0,
    unoSaid:   {},
  };
}

export function nextPlayerIndex(ci, dir, n) {
  return (ci + dir + n) % n;
}

export function reshuffleUno(g) {
  const top = g.unoDiscardPile[g.unoDiscardPile.length-1];
  g.unoDrawPile = shuffle(g.unoDiscardPile.slice(0, g.unoDiscardPile.length-1));
  g.unoDiscardPile = [top];
}

export function drawUnoCards(g, playerId, count) {
  for (let i=0;i<count;i++) {
    if (g.unoDrawPile.length===0) reshuffleUno(g);
    if (g.unoDrawPile.length>0) {
      g.unoHands[playerId] = [...(g.unoHands[playerId]||[]), g.unoDrawPile.pop()];
    }
  }
}

/**
 * ★変更箇所③: トランプをまとめて出す処理（一括で配列を場に出す）
 */
export function applyTrumpPlay(g, playerId, cardIds, playerName) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return null;

  const hand = [...(g.trumpHands[playerId]||[])];
  const selectedCards = [];

  for (const id of cardIds) {
    const card = hand.find(c=>c.id===id);
    if (!card) return null;
    selectedCards.push(card);
  }

  // 出せるか最終チェック
  if (!trumpCanPlay(selectedCards, g.trumpField)) return null;

  // 手札から一括削除
  g.trumpHands[playerId] = hand.filter(c => !cardIds.includes(c.id));
  g.trumpField = selectedCards; // 場のカードを配列として上書き

  let extra = '';
  const hasJokerSingle = selectedCards.length === 1 && selectedCards[0].v === 'JOKER';
  const has8 = selectedCards.some(c => c.v === '8');

  if (hasJokerSingle) {
    g.trumpField = []; g.hasParent = playerId;
    extra = 'ジョーカー！場が流れた 👑親になった';
  } else if (has8) {
    g.trumpField = []; g.hasParent = playerId;
    extra = '8切り！場が流れた 👑親になった';
  }

  g.phase = 'uno';
  const cardNames = selectedCards.map(c => `${c.s}${c.v}`).join(',');
  return {
    g,
    logMsg: `${playerName}がトランプ[${cardNames}]を出した${extra?' '+extra:''}`,
  };
}

export function applyTrumpPass(g, playerId, playerName) {
  g.phase = 'uno';
  return { g, logMsg: `${playerName}がトランプをパス` };
}

export function applyUnoPlay(g, playerId, cardIdx, chosenColor, playerName) {
  const myHand = [...(g.unoHands[playerId]||[])];
  const card = myHand[cardIdx];
  if (!card) return null;
  const topUno = g.unoDiscardPile[g.unoDiscardPile.length-1];
  if (!unoCanPlay(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum)) return null;

  myHand.splice(cardIdx,1);
  g.unoHands[playerId] = myHand;
  g.unoDiscardPile.push(card);

  if (card.t==='w'||card.t==='w4') g.unoCurrentColor = chosenColor||'red';
  else g.unoCurrentColor = card.c;

  if (card.t!=='d2' && card.t!=='w4') g.unoPenaltyAccum = 0;

  let logExtra = '';
  const n = g.order.length;

  if (!g.unoSaid) g.unoSaid={};
  if (myHand.length===1 && !g.unoSaid[playerId]) {
    drawUnoCards(g, playerId, 2);
    logExtra += '（UNO忘れ！2枚引き）';
  }
  if (myHand.length!==1) delete g.unoSaid[playerId];

  let skipNext = false;
  if (card.t==='rev') {
    g.dir *= -1;
    logExtra += ' リバース！';
  } else if (card.t==='skip') {
    skipNext = true;
    logExtra += ' スキップ！';
  } else if (card.t==='d2') {
    g.unoPenaltyAccum = (g.unoPenaltyAccum||0)+2;
    logExtra += ` +2（累積${g.unoPenaltyAccum}枚）`;
  } else if (card.t==='w4') {
    g.unoPenaltyAccum = (g.unoPenaltyAccum||0)+4;
    logExtra += ` +4（累積${g.unoPenaltyAccum}枚）`;
  } else if (card.t==='w') {
    logExtra += ` ワイルド！${UNO_COLOR_NAMES[chosenColor]}色に変更`;
  }

  const trumpDone = (g.trumpHands[playerId]||[]).length===0;
  const isWinner  = trumpDone && myHand.length===0;
  if (isWinner) {
    if (!g.rankings) g.rankings=[];
    if (!g.rankings.some(r=>r.id===playerId)) g.rankings.push({id:playerId, name:playerName});
    g.order = g.order.filter(id=>id!==playerId);
  }

  g.phase = 'trump';
  const curOrderLen = g.order.length;
  if (curOrderLen > 0) {
    const myIdx = g.order.indexOf(playerId);
    if (myIdx === -1) {
      g.ci = g.ci % curOrderLen;
    } else {
      let nxt = (myIdx + g.dir + curOrderLen) % curOrderLen;
      if (skipNext && curOrderLen > 1) nxt = (nxt + g.dir + curOrderLen) % curOrderLen;
      g.ci = nxt;
    }
  }

  const isGameOver = g.order.length <= 1;
  if (isGameOver && g.order.length===1) {
    const lastId = g.order[0];
    if (!g.rankings.some(r=>r.id===lastId)) g.rankings.push({id:lastId, name:'?'});
  }

  return {
    g,
    logMsg: `${playerName}がUNO[${card.v}]を出した${logExtra?' '+logExtra:''}`,
    isGameOver,
  };
}

export function applyUnoDraw(g, playerId, playerName) {
  const n = g.order.length;
  let logMsg = '';

  if (g.unoPenaltyAccum > 0) {
    const count = g.unoPenaltyAccum;
    drawUnoCards(g, playerId, count);
    g.unoPenaltyAccum = 0;
    logMsg = `${playerName}がペナルティ${count}枚引いた（手番は継続）`;
  } else {
    drawUnoCards(g, playerId, 1);
    logMsg = `${playerName}がUNOを1枚引いた`;
  }

  g.phase = 'trump';
  const myIdx = g.order.indexOf(playerId);
  if (myIdx !== -1) g.ci = (myIdx + g.dir + n) % n;

  return { g, logMsg };
}
