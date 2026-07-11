// ========================================
// test-bot.ts — テスト用自動プレイボット（開発・検証専用）
//
// 責務：
//   「出せるカードがあれば必ず出す」というシンプルな貪欲(greedy)ロジックで
//   自分の手番を自動的に進める。
//
// 設計方針：
//   - DOMのクラス名やチェックボックスを探してクリックを模倣する方式は、
//     UI側の実装（クラス名等）が変わるたびに静かに壊れて気づきにくい
//     （実際に前回発生した「全部パスする」「引くだけする」バグの原因）。
//   - そのため、DOMは一切見ず、window._currentGame / window._currentTrumpHand
//     から直接「今出せるカード」を計算し、game-actions.js の
//     actionTrumpPlay / actionUnoPlay 等を直接呼び出す。
//     「カードを選択してから送信する」という2ステップは、
//     actionTrumpPlay(cardIds) / actionUnoPlay(idx, color) という
//     1回の呼び出しに集約されるので、選択漏れが起こりようがない。
//
// ビルド：
//   trump-logic.ts と同様、ブラウザでは動かせないため
//   コンパイルして test-bot.js を生成し、index.html からは
//   .js の方を読み込む（.ts をそのまま <script> で読み込まない）。
//
// このファイルは本番運用では不要。index.html から
// <script type="module" src="js/test-bot.js"></script> の1行を
// 削除するだけで完全に無効化できる（app.js には一切変更不要）。
// ========================================

// @ts-ignore -- state.js はプレーンJS（型定義なし）
import { state } from '../state.js';
// @ts-ignore -- game-actions.js はプレーンJS（型定義なし）
import {
  actionTrumpPlay,
  actionTrumpPass,
  actionTrumpSkip,
  actionUnoPlay,
  actionUnoDraw,
  actionUnoSkip,
  actionSayUno,
  actionPickParentColor,
  actionSetAutoPlay,
} from '../actions/game-actions.js';
import { trumpCanPlay, type TrumpCard, type PartialGameState } from '../logic/trump-logic.js';
// @ts-ignore -- uno-logic.js はプレーンJS（型定義なし）
import { unoCanPlay } from '../logic/uno-logic.js';

// ----------------------------------------
// 型定義（このファイル内で完結させる最小限の型）
// ----------------------------------------

type UnoColor = 'red' | 'blue' | 'green' | 'yellow';
type UnoCardType = 'num' | 'skip' | 'rev' | 'd2' | 'w' | 'w4';

interface UnoCard {
  c: UnoColor | 'w';
  t: UnoCardType;
  v: string;
}

/** trump-logic.ts の TrumpGameState を、このファイルで実際に使うUNOフィールドまで拡張したもの */
interface FusionGameState extends PartialGameState {
  order: string[];
  ci: number;
  phase: 'trump' | 'uno';
  trumpField: TrumpCard[];
  hasParent?: string;
  unoHands: Record<string, UnoCard[]>;
  unoDiscardPile: UnoCard[];
  unoCurrentColor: UnoColor;
  unoPenaltyAccum?: number;
}

// window 拡張の型宣言（ビルド時にany扱いになるのを避けるため）
declare global {
  interface Window {
    _currentGame: FusionGameState | null;
    _currentTrumpHand: TrumpCard[];
    _roomState: string | null;
    toggleTestBot: () => void;
    toggleMonkeyPlay: () => void;
  }
}

const UNO_COLORS: UnoColor[] = ['red', 'blue', 'green', 'yellow'];

let botTimer: ReturnType<typeof setInterval> | null = null;
let lastSignature = '';
let lastChangeAt = 0;
// ★バグ修正★ 「同じ signature が何回連続で来たか」という“回数”ベースの
// スタック検知は、setInterval のtickは実時間を保証しない
// （バックグラウンドタブでの間引き・Firebaseの書き込み～listener反映の
// ラグ等でtickの間隔は簡単に伸び縮みする）ため、実際は全く詰んでいない
// のに「たまたま数回連続で同じsignatureを観測しただけ」で誤検知して
// ボットが勝手にOFFになってしまうことがあった。
// 特に「トランプ・UNOの片方を出し切って、スキップ処理がFirebaseの
// 書き込み～反映を挟んで完了するまでの数百ms～数秒の間」は、
// signatureが変化しないtickが連続しやすく、このタイミングで
// 誤検知が起きやすかった（体感的に「片方を出し切った直後にボットが
// 止まる」ように見えていたのはこれが原因）。
// tickの回数ではなく「最後にsignatureが変化してからの実経過時間」を
// Date.now() で計測し、それが閾値を超えた場合のみ本当に詰んでいると
// 判定するように変更する。
const STUCK_THRESHOLD_MS = 8000; // 実時間8秒、signatureが一切変化しなければ本当に詰んでいるとみなす

// ★バグ修正★ Firebaseへの書き込み（await）が800msのtick間隔より長く
// かかった場合、前回の step() がまだ完了していないのに次の setInterval
// tickが発火し、同じ手番に対して actionTrumpPlay/actionUnoDraw 等を
// 二重に呼び出してしまう競合状態があった（ネットワークが遅い時に
// 顕著）。二重送信はサーバ側のバリデーションエラーを引き起こし、
// エラーがログに出るだけで何も進行しないまま次のtickでも同じ状態を
// 観測し続ける → 上のスタック誤検知にもつながっていた。
// 処理中フラグで多重実行そのものを防ぐ。
let isProcessing = false;

function log(...args: unknown[]): void {
  console.log('%c[TestBot]', 'color:#e67e22;font-weight:bold', ...args);
}

// ----------------------------------------
// トランプ：出せる最初の1枚（単騎）を探す
// ----------------------------------------
function findPlayableTrumpSingle(
  hand: TrumpCard[],
  fieldCards: TrumpCard[],
  g: FusionGameState
): TrumpCard | null {
  for (const card of hand) {
    if (trumpCanPlay([card], fieldCards, g)) return card;
  }
  return null;
}

// ----------------------------------------
// UNO：出せる最初の1枚を探す（インデックスを返す）
// ----------------------------------------
function findPlayableUnoIdx(
  hand: UnoCard[],
  top: UnoCard,
  currentColor: UnoColor,
  penaltyAccum: number
): number {
  for (let i = 0; i < hand.length; i++) {
    const card = hand[i];
    if (card && unoCanPlay(card, top, currentColor, penaltyAccum)) return i;
  }
  return -1;
}

// ----------------------------------------
// 手札の中で一番枚数が多い色を選ぶ（親の権限・ワイルド用）
// ----------------------------------------
function pickBestColor(hand: UnoCard[]): UnoColor {
  const counts: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0 };
  hand.forEach(c => {
    if (c.c !== 'w' && counts[c.c] !== undefined) counts[c.c]++;
  });
  let best: UnoColor = UNO_COLORS[0]!;
  UNO_COLORS.forEach(c => { if (counts[c] > counts[best]) best = c; });
  return best;
}

// ----------------------------------------
// 1手番分の思考・実行
// ----------------------------------------
async function step(): Promise<void> {
  // ★バグ修正★ 前回の step() がまだ Firebase への書き込みを待っている
  // 最中なら、今回の tick は丸ごとスキップする（多重送信防止）。
  if (isProcessing) return;

  const g = window._currentGame;
  if (!g || window._roomState !== 'playing') return;

  const isMyTurn = g.order[g.ci] === state.myId;
  if (!isMyTurn) {
    lastSignature = '';
    lastChangeAt = 0;
    return;
  }

  const trumpHand: TrumpCard[] = window._currentTrumpHand || [];
  const unoHand: UnoCard[] = (g.unoHands && g.unoHands[state.myId]) || [];

  // ─── 進行不能（スタック）の自動検知（実経過時間ベース） ───
  const signature = `${g.phase}-${g.ci}-${trumpHand.length}-${unoHand.length}-${g.unoPenaltyAccum || 0}`;
  const now = Date.now();
  if (signature === lastSignature) {
    if (lastChangeAt === 0) lastChangeAt = now; // 念のための初期化
    const elapsed = now - lastChangeAt;
    if (elapsed >= STUCK_THRESHOLD_MS) {
      log(
        `進行不能（スタック）を検知したため自動停止しました（signature="${signature}" が ${Math.round(elapsed / 1000)}秒変化していません）`,
        g
      );
      window.toggleTestBot();
      return;
    }
  } else {
    lastSignature = signature;
    lastChangeAt = now;
  }

  isProcessing = true;
  try {
    // ─── トランプフェイズ ───
    if (g.phase === 'trump') {
      if (trumpHand.length === 0) {
        await actionTrumpSkip();
        return;
      }
      const fieldCards: TrumpCard[] = Array.isArray(g.trumpField) ? g.trumpField : [];
      const playable = findPlayableTrumpSingle(trumpHand, fieldCards, g);
      if (playable) {
        log('トランプを出す →', playable.id);
        const result = await actionTrumpPlay([playable.id]);
        if (result?.error) log('⚠️ actionTrumpPlay がエラーを返した →', result.error);
      } else {
        log('出せるトランプが無いためパス');
        const result = await actionTrumpPass();
        if (result?.error) log('⚠️ actionTrumpPass がエラーを返した →', result.error);
      }
      return;
    }

    // ─── UNOフェイズ ───
    if (g.phase === 'uno') {
      // 親の権限があり、まだUNOが残っているなら先に色を有利な色へ変更しておく
      // （UNOを出し切り済みの場合は actionPickParentColor 自体がターンを
      //   進めてしまうので、その場合は下の「0枚スキップ」に任せる）
      if (g.hasParent === state.myId && unoHand.length > 0) {
        const color = pickBestColor(unoHand);
        log('親の権限で色を変更 →', color);
        await actionPickParentColor(color);
        // ★バグ修正★ ここで得られる g / unoCurrentColor は色変更前の
        // 古いスナップショットのまま。そのまま下の判定に進むと、古い色を
        // 基準にカードの出せる/出せないを誤判定するおそれがあるため、
        // 今回の tick はここで終了し、次の tick で最新状態を読み直してから
        // 「出す/引く」の判断をする。
        return;
      }

      if (unoHand.length === 0) {
        await actionUnoSkip();
        return;
      }

      const top = g.unoDiscardPile[g.unoDiscardPile.length - 1];
      if (!top) return;
      const idx = findPlayableUnoIdx(unoHand, top, g.unoCurrentColor, g.unoPenaltyAccum || 0);

      if (idx !== -1) {
        const card = unoHand[idx]!;
        const isWild = card.t === 'w' || card.t === 'w4';
        const color = isWild ? pickBestColor(unoHand.filter((_, i) => i !== idx)) : null;
        // ★バグ修正★ 以前は actionUnoPlay の「後」に actionSayUno を呼んでいたため、
        // actionUnoPlay が手札を1枚にした時点でサーバー側が即座に
        // 「UNO未宣言」と判定してペナルティ（2枚ドロー）を確定させてしまい、
        // その後に届く actionSayUno は常に手遅れになっていた
        // （ログで「UNO忘れ！2枚引き」の直後に「UNO！と叫んだ」が
        //   続けて出ていたのはこれが原因）。
        // これを出すと残り1枚になる場合は、actionUnoPlay を呼ぶ前に
        // 先に actionSayUno を送っておく。
        if (unoHand.length === 2) {
          log('残り1枚になるため先にUNO宣言 →');
          const unoResult = await actionSayUno();
          if (unoResult?.error) log('⚠️ actionSayUno がエラーを返した →', unoResult.error);
        }
        log('UNOを出す →', card, isWild ? `(色: ${color})` : '');
        const result = await actionUnoPlay(idx, color);
        if (result?.error) log('⚠️ actionUnoPlay がエラーを返した →', result.error);
      } else {
        log('出せるUNOが無いため引く');
        const result = await actionUnoDraw();
        if (result?.error) log('⚠️ actionUnoDraw がエラーを返した →', result.error);
      }
      return;
    }
  } catch (err) {
    // ★バグ修正★ actionXxx が reject した場合、以前は step() 内で
    // 例外がキャッチされずに終わり、hand数などが一切変化しないまま
    // 次のtickへ突入していた。これも「signatureが変化しない」原因の
    // 一つになり得たため、必ずログに出して原因を追えるようにする。
    log('⚠️ step() 実行中に例外が発生しました →', err);
  } finally {
    isProcessing = false;
  }
}

// ----------------------------------------
// ON/OFF切り替え（既存のボタン onclick="toggleMonkeyPlay()" からも
// そのまま呼べるよう、旧名にもエイリアスしておく）
// ----------------------------------------
window.toggleTestBot = (): void => {
  const btn = document.getElementById('monkey-toggle-btn');
  if (botTimer) {
    clearInterval(botTimer);
    botTimer = null;
    lastSignature = '';
    lastChangeAt = 0;
    isProcessing = false;
    if (btn) { btn.textContent = '🐒 自動ON'; btn.style.background = '#ff9800'; }
    log('停止しました');
    // ★機能追加★ 他プレイヤーにも自動プレイOFFを知らせる
    void actionSetAutoPlay(false);
    return;
  }
  if (btn) { btn.textContent = '🐒 自動OFF'; btn.style.background = '#e74c3c'; }
  log('開始しました（出せるカードがあれば必ず出す greedy AI）');
  botTimer = setInterval(step, 800);
  // ★機能追加★ 他プレイヤーにも自動プレイONを知らせる
  // （rooms/{roomId}/autoPlayers/{myId} に書き込み、ui-render.js の
  //   対戦相手一覧に🐒バッジとして表示される）
  void actionSetAutoPlay(true);
};

window.toggleMonkeyPlay = window.toggleTestBot;
