// ========================================
// リプレイエンジン
//
// Firebase・DOMに一切依存しない、純粋な「状態機械」。
// actionLog を1件ずつ、game-actions.js と全く同じ手順
// （apply系関数を呼ぶ → checkAllPassed → resolveRankingNames）で
// 再生していく。
//
// ★重要な設計方針★
// リプレイ専用のゲームルールを別途書くのではなく、本番で実際に使われている
// applyTrumpPlay / applyUnoPlay / game-rules.js の関数をそのまま呼び出す。
// こうすることで、将来ゲームルールが変わっても（バグ修正・仕様変更など）
// リプレイの再生結果が自動的に追従し、二重メンテナンスにならない。
// ========================================
import { applyTrumpPlay, applyTrumpPass } from '../logic/trump-logic';
// @ts-ignore -- uno-logic.js はプレーンJS（型定義なし）
import { applyUnoPlay, applyUnoDraw } from '../logic/uno-logic.js';
// @ts-ignore -- game-rules.js はプレーンJS（型定義なし）
import {
  checkAllPassed,
  resolveRankingNames,
  applyTrumpSkip,
  applyUnoSkip,
  applyParentColorChange,
  applyUnoDeclaration,
} from '../logic/game-rules';
import type {
  ReplayActionLogEntry,
  ReplayFile,
  ReplayPlayerInfo,
  ReplayFusionGameState,
  TrumpPlayArgs,
  UnoPlayArgs,
  PickParentColorArgs,
} from './types';

export class ReplayEngine {
  private readonly players: ReplayPlayerInfo[];
  private readonly actionLog: ReplayActionLogEntry[];
  private readonly initialState: ReplayFusionGameState;

  private game: ReplayFusionGameState;
  private log: string[] = [];
  private trumpPassCount = 0;
  private cursor = 0; // 「次に適用する actionLog の index」＝これまでに再生した手数

  constructor(replay: ReplayFile) {
    this.players = replay.players;
    this.actionLog = replay.actionLog;
    // reset() のたびに書き換えるため、渡されたオブジェクトを汚さないよう複製しておく
    this.initialState = JSON.parse(JSON.stringify(replay.initialState));
    this.game = JSON.parse(JSON.stringify(this.initialState));
  }

  /** actionLogの総手数 */
  get totalSteps(): number { return this.actionLog.length; }
  /** 現在何手目まで再生済みか（0=まだ何も再生していない） */
  get currentIndex(): number { return this.cursor; }
  /** 現在のゲーム状態（全員の手札を含む） */
  get currentGame(): ReplayFusionGameState { return this.game; }
  /** 現在までのゲームログ（直近8件） */
  get currentLog(): string[] { return this.log; }
  getPlayers(): ReplayPlayerInfo[] { return this.players; }
  getEntryAt(index: number): ReplayActionLogEntry | undefined { return this.actionLog[index]; }

  /** 初期状態まで巻き戻す */
  reset(): void {
    this.game = JSON.parse(JSON.stringify(this.initialState));
    this.log = [];
    this.trumpPassCount = 0;
    this.cursor = 0;
  }

  private playerName(playerId: string): string {
    return this.players.find(p => p.id === playerId)?.name ?? '?';
  }

  private appendLog(msg: string | null | undefined): void {
    if (!msg) return;
    this.log = [...this.log, msg].slice(-8);
  }

  /**
   * 1手だけ進める。
   * これ以上進められない（actionLogの末尾に到達した）場合は false を返す。
   */
  stepForward(): boolean {
    const entry = this.actionLog[this.cursor];
    if (!entry) return false;
    const g = this.game as any;
    const pname = this.playerName(entry.playerId);

    switch (entry.type) {
      case 'trumpPlay': {
        const args = entry.args as TrumpPlayArgs;
        const result = applyTrumpPlay(g, entry.playerId, args.cardIds, pname);
        if (result) {
          if (result.isGameOver) resolveRankingNames(result.g.rankings, this.players);
          this.appendLog(result.logMsg);
          this.trumpPassCount = 0;
        }
        break;
      }
      case 'trumpPass': {
        const passCount = this.trumpPassCount + 1;
        const { logMsg } = applyTrumpPass(g, entry.playerId, pname);
        this.appendLog(logMsg);
        const passResult = checkAllPassed(g, passCount, this.players);
        if (passResult.cleared) this.appendLog(passResult.logMsg);
        this.trumpPassCount = passResult.cleared ? 0 : passCount;
        break;
      }
      case 'trumpSkip': {
        const passCount = this.trumpPassCount + 1;
        const { logMsg, isGameOver, finished } = applyTrumpSkip(g, entry.playerId, pname);
        this.appendLog(logMsg);
        if (isGameOver) {
          resolveRankingNames(g.rankings, this.players);
        } else if (!finished) {
          const passResult = checkAllPassed(g, passCount, this.players);
          if (passResult.cleared) this.appendLog(passResult.logMsg);
          this.trumpPassCount = passResult.cleared ? 0 : passCount;
        }
        break;
      }
      case 'unoPlay': {
        const args = entry.args as UnoPlayArgs;
        const result = applyUnoPlay(g, entry.playerId, args.cardIdx, args.chosenColor, pname);
        if (result) {
          if (result.isGameOver) resolveRankingNames(result.g.rankings, this.players);
          this.appendLog(result.logMsg);
          const passResult = checkAllPassed(result.g, this.trumpPassCount, this.players);
          if (passResult.cleared) this.appendLog(passResult.logMsg);
          this.trumpPassCount = passResult.cleared ? 0 : this.trumpPassCount;
        }
        break;
      }
      case 'unoDraw': {
        const { logMsg } = applyUnoDraw(g, entry.playerId, pname);
        this.appendLog(logMsg);
        const passResult = checkAllPassed(g, this.trumpPassCount, this.players);
        if (passResult.cleared) this.appendLog(passResult.logMsg);
        this.trumpPassCount = passResult.cleared ? 0 : this.trumpPassCount;
        break;
      }
      case 'unoSkip': {
        const { logMsg, isGameOver, finished } = applyUnoSkip(g, entry.playerId, pname);
        this.appendLog(logMsg);
        if (isGameOver) resolveRankingNames(g.rankings, this.players);
        if (!isGameOver && !finished) {
          const passResult = checkAllPassed(g, this.trumpPassCount, this.players);
          if (passResult.cleared) this.appendLog(passResult.logMsg);
          this.trumpPassCount = passResult.cleared ? 0 : this.trumpPassCount;
        }
        break;
      }
      case 'sayUno': {
        const { logMsg } = applyUnoDeclaration(g, entry.playerId, pname);
        this.appendLog(logMsg);
        break;
      }
        case 'pickParentColor': {
        const args = entry.args as PickParentColorArgs;
        const result = applyParentColorChange(g, entry.playerId, args.color, pname);
        if (result) {
          if (result.isGameOver) resolveRankingNames(g.rankings, this.players);
          this.appendLog(result.logMsg);
        }
        break;
      }
    }

    this.cursor += 1;
    return true;
  }

  /**
   * 1手だけ戻す。
   * 実装は単純に「初期状態から目的の手数まで再生し直す」方式。
   * 1ゲームでもせいぜい数百手程度なので、体感の速度としては十分。
   */
  stepBackward(): boolean {
    if (this.cursor === 0) return false;
    this.goTo(this.cursor - 1);
    return true;
  }

  /** 任意の手数まで進める・戻す（スライダーでの巻き戻し等に使う） */
  goTo(index: number): void {
    const clamped = Math.max(0, Math.min(index, this.totalSteps));
    if (clamped < this.cursor) this.reset();
    while (this.cursor < clamped) this.stepForward();
  }
}
