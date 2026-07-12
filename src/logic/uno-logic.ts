/// ========================================
// UNO ロジック
// ========================================
import type { GameState, UnoCard } from './types';

export const UNO_COLORS: string[] = ['red', 'blue', 'green', 'yellow'];
export const UNO_COLOR_NAMES: Record<string, string> = { red: '赤', blue: '青', green: '緑', yellow: '黄' };

/**
 * UNOデッキを生成する
 */
export function buildUnoDeck(): UnoCard[] {
  const d: UnoCard[] = [];
  UNO_COLORS.forEach(c => {
    d.push({ c, t: 'num', v: '0' });
    for (let i = 1; i <= 9; i++) {
      d.push({ c, t: 'num', v: '' + i });
      d.push({ c, t: 'num', v: '' + i });
    }
    [{ t: 'skip', v: '⊘' }, { t: 'rev', v: '⇄' }, { t: 'd2', v: '+2' }].forEach(x => {
      d.push({ c, t: x.t, v: x.v });
      d.push({ c, t: x.t, v: x.v });
    });
  });
  for (let i = 0; i < 4; i++) {
    d.push({ c: 'w', t: 'w', v: 'W' });
    d.push({ c: 'w', t: 'w4', v: '+4' });
  }
  return d;
}

/**
 * カードが出せるかどうか判定する
 */
export function unoCanPlay(card: UnoCard, top: UnoCard, currentColor: string, penaltyAccum: number): boolean {
  if (penaltyAccum > 0) {
    return (top.t === 'd2' && card.t === 'd2') || (top.t === 'w4' && card.t === 'w4');
  }
  if (card.t === 'w' || card.t === 'w4') return true;
  if (card.c === currentColor) return true;
  if (card.t === 'num' && top.t === 'num' && card.v === top.v) return true;
  if (card.t !== 'num' && card.t === top.t) return true;
  return false;
}

/**
 * カードのCSSカラークラス名を返す
 */
export function unoCardColorClass(card: UnoCard): string {
  return (card.t === 'w' || card.t === 'w4') ? 'w' : card.c[0]!;
}

/**
 * 山札が切れた場合に捨て山をシャッフルして補充する（破壊的）
 */
export function reshuffleUno(g: GameState): void {
  if (!g.unoDiscardPile || g.unoDiscardPile.length === 0) return; // 捨て山が空なら何もしない
  const top = g.unoDiscardPile[g.unoDiscardPile.length - 1]!;
  g.unoDrawPile = shuffle(g.unoDiscardPile.slice(0, g.unoDiscardPile.length - 1));
  g.unoDiscardPile = [top];
}

/**
 * プレイヤーにUNOのカードを引かせる（破壊的）
 *
 * ★バグ修正（Firebase Realtime Databaseの空配列対策仕様）★
 * 山札を最後の1枚まで引き切ると g.unoDrawPile = [] になり、Firebaseに
 * 保存する際にこの空配列ごとキーが削除されて undefined になる
 * （RTDBは空配列/空オブジェクトを保存しない）。
 * uno-logic.ts の applyUnoPlay で g.trumpHands 丸ごと undefined 化に
 * 対応したのと同じ理由・同じパターンの対策を、山札(unoDrawPile)にも入れる。
 */
export function drawUnoCards(g: GameState, playerId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    if (!g.unoDrawPile || g.unoDrawPile.length === 0) reshuffleUno(g);
    if (g.unoDrawPile && g.unoDrawPile.length > 0) {
      const card = g.unoDrawPile.pop();
      if (card) {
        g.unoHands[playerId] = [...(g.unoHands[playerId] || []), card];
      }
    }
  }
}

export interface UnoPlayResult {
  g: GameState;
  logMsg: string;
  isGameOver: boolean;
}

/**
 * UNOカードを出す処理（破壊的）
 */
export function applyUnoPlay(
  g: GameState,
  playerId: string,
  cardIdx: number | null,
  chosenColor: string | null,
  playerName: string
): UnoPlayResult | null {
  if (cardIdx === null) return null;

  const myHand = [...(g.unoHands[playerId] || [])];
  const card = myHand[cardIdx];
  if (!card) return null;

  const topUno = g.unoDiscardPile[g.unoDiscardPile.length - 1]!;
  if (!unoCanPlay(card, topUno, g.unoCurrentColor, g.unoPenaltyAccum)) return null;

  myHand.splice(cardIdx, 1);
  g.unoHands[playerId] = myHand;
  g.unoDiscardPile.push(card);

  // ワイルド系: chosenColor が正しく渡された場合のみ色を変更する
  // chosenColor が null/undefined の場合は現在の色を維持する
  // (色ピッカーを経由せずに呼ばれたときの誤った 'red' 固定を防ぐ)
  if (card.t === 'w' || card.t === 'w4') {
    g.unoCurrentColor = chosenColor ?? g.unoCurrentColor;
  } else {
    g.unoCurrentColor = card.c;
  }

  if (card.t !== 'd2' && card.t !== 'w4') g.unoPenaltyAccum = 0;

  let logExtra = '';
  if (!g.unoSaid) g.unoSaid = {};
  if (myHand.length === 1 && !g.unoSaid[playerId]) {
    drawUnoCards(g, playerId, 2);
    logExtra += '（UNO忘れ！2枚引き）';
  }
  if (myHand.length !== 1) delete g.unoSaid[playerId];

  let skipNext = false;
  if (card.t === 'rev') {
    g.dir *= -1;
    logExtra += ' リバース！';
  } else if (card.t === 'skip') {
    skipNext = true;
    logExtra += ' スキップ！';
  } else if (card.t === 'd2') {
    g.unoPenaltyAccum = (g.unoPenaltyAccum || 0) + 2;
    logExtra += ` +2（累積${g.unoPenaltyAccum}枚）`;
  } else if (card.t === 'w4') {
    g.unoPenaltyAccum = (g.unoPenaltyAccum || 0) + 4;
    logExtra += ` +4（累積${g.unoPenaltyAccum}枚）`;
  } else if (card.t === 'w') {
    logExtra += ` ワイルド！${UNO_COLOR_NAMES[chosenColor ?? '']}色に変更`;
  }

  // ★バグ修正（Firebase Realtime Databaseの空配列対策仕様）★
  // 全員のトランプ手札が0枚になると、Firebase側で trumpHands オブジェクトの
  // 中身が全員分空になり、親キー trumpHands ごと丸ごと削除されて undefined に
  // なる（RTDBは空配列/空オブジェクトを保存しない）。
  // g.trumpHands 自体が undefined な場合は「全員トランプ完了済み」とみなし、
  // このプレイヤーのトランプも完了扱いにする（game-rules.ts の
  // finalizeIfBothHandsEmpty と同じ対策）。
  const trumpDone = !g.trumpHands || (g.trumpHands[playerId] || []).length === 0;
  const isWinner = trumpDone && myHand.length === 0;
  if (isWinner) {
    if (!g.rankings) g.rankings = [];
    if (!g.rankings.some(r => r.id === playerId)) {
      g.rankings.push({ id: playerId, name: playerName });
    }
    g.order = g.order.filter(id => id !== playerId);
  }

  // ★バグ修正★ 親の色変更権限は「自分のUNOターン中に使うか、使わず終わるか」の一発勝負。
  // pickParentColor 経由で行使済みなら applyParentColorChange で既に null になっているので
  // ここでは何もしない。行使せずこのターンを終える場合はここで確実に失効させる。
  // (以前は applyUnoPlay 経由でターンが終わっても権限が消えず、「貯まる」バグの原因だった)
  if (g.hasParent === playerId) g.hasParent = null;

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
  if (isGameOver && g.order.length === 1) {
    const lastId = g.order[0]!;
    if (!g.rankings.some(r => r.id === lastId)) {
      g.rankings.push({ id: lastId, name: '?' });
    }
  }

  return {
    g,
    logMsg: `${playerName}がUNO[${card.v}]を出した${logExtra ? ' ' + logExtra : ''}`,
    isGameOver,
  };
}

export interface UnoDrawResult {
  g: GameState;
  logMsg: string;
}

/**
 * UNOカードを引く処理（破壊的）
 */
export function applyUnoDraw(g: GameState, playerId: string, playerName: string): UnoDrawResult {
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

  // ★バグ修正★ 親の権限を行使せずこのターンを終える場合、ここで確実に失効させる
  // (applyUnoPlay と同じ理由。カードを「引く」で自分のUNOターンを終えるケースでも
  // 以前は権限が消滅せず残り続けてしまっていた)
  if (g.hasParent === playerId) g.hasParent = null;

  // ★バグ修正★ UNO宣言後にカードを引いた場合、手札が増えて「残り1枚になる」
  // 状況ではなくなるため、宣言状態をリセットする。
  // (以前は宣言が残り続け、手札3枚以上でも📢UNOバッジが表示されたままになり、
  //  次に2枚→1枚を出すときにも宣言不要になってしまっていた)
  if (g.unoSaid && g.unoSaid[playerId]) delete g.unoSaid[playerId];

  g.phase = 'trump';
  const myIdx = g.order.indexOf(playerId);
  if (myIdx !== -1) g.ci = (myIdx + g.dir + n) % n;

  return { g, logMsg };
}

// shuffle は game-init.js から再エクスポートされるが、内部でも使用するため定義する
function shuffle<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}