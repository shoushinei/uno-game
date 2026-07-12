// ========================================
// リプレイ機能: 型定義
//
// actionLog（操作の履歴） / replayInitialState（ゲーム開始直後の状態）と、
// 保存用JSONファイル（ReplayFile）の形をここで一元管理する。
// DOM・Firebaseには一切依存しない、純粋な型定義だけのファイル。
// ========================================
import type { TrumpCard } from '../logic/trump-logic';

// このゲームで発生しうる「操作」の種類一覧
export type ReplayActionType =
  | 'trumpPlay'       // トランプを出す
  | 'trumpPass'       // トランプをパスする
  | 'trumpSkip'       // トランプ0枚による自動スキップ
  | 'unoPlay'         // UNOを出す
  | 'unoDraw'         // UNOを引く
  | 'unoSkip'         // UNO0枚による自動スキップ
  | 'sayUno'          // 「UNO！」宣言
  | 'pickParentColor'; // 親の権限でUNOの色を変更

// ---- 各操作ごとの引数（args）の形 ----
export interface TrumpPlayArgs { cardIds: string[] }
export interface EmptyArgs { [key: string]: never } // 引数を持たない操作用（パス・スキップ・UNO宣言など）
export interface UnoPlayArgs {
  cardIdx: number;
  chosenColor: string | null;
  /**
   * ★PC UI（ホバーカード）で追加★ 出したカード自体。
   * cardIdx だけでは後からカードを特定できない（手札から消えるため）ので、
   * 表示用に記録する。再生（リプレイ）はこのフィールドを使わないため、
   * 記録されていない古いリプレイファイルとも互換（optional）。
   */
  card?: { c: string; t: string; v: string } | null;
}
/** ★PC UI（ホバーカード）で追加★ 引いた枚数の記録（表示用・optional） */
export interface UnoDrawArgs { count?: number }
export interface PickParentColorArgs { color: string }

export type ReplayActionArgs =
  | TrumpPlayArgs
  | EmptyArgs
  | UnoPlayArgs
  | UnoDrawArgs
  | PickParentColorArgs;

/**
 * actionLog の1エントリ。
 * 再生（リプレイ）に本当に必要な情報だけに絞ってある。
 * 人間向けのログメッセージ（logMsg）は再生時に applyXxx 側が
 * 毎回自動生成してくれるので、ここには保存しない。
 */
export interface ReplayActionLogEntry {
  type: ReplayActionType;
  playerId: string;
  args: ReplayActionArgs;
  /** 実際に操作が行われた時刻（ミリ秒）。再生時の「テンポ」表示にも使う */
  ts: number;
}

/** リプレイに登場するプレイヤーの最小限の情報 */
export interface ReplayPlayerInfo {
  id: string;
  name: string;
}

/** UNOカードの型（uno-logic.js 側はプレーンJSで型が無いため、ここで最小限定義する） */
export interface ReplayUnoCard {
  c: string; // 色（red/blue/green/yellow/w）
  t: string; // カード種別（num/skip/rev/d2/w/w4）
  v: string; // 表示上の値
}

/** initFusionGame() が返す「融合ゲーム状態」のスナップショット */
export interface ReplayFusionGameState {
  order: string[];
  ci: number;
  dir: number;
  phase: 'trump' | 'uno';
  rankings: Array<{ id: string; name: string }>;

  trumpHands: Record<string, TrumpCard[]>;
  trumpField: TrumpCard[];
  trumpFieldMeta: unknown;
  trumpFieldOwner: string | null;
  trumpRevolution: boolean;
  trumpElevenBack: boolean;
  trumpSuitLock: string[] | null;
  trumpEffect: unknown;
  hasParent: string | null;

  unoHands: Record<string, ReplayUnoCard[]>;
  unoDrawPile: ReplayUnoCard[];
  unoDiscardPile: ReplayUnoCard[];
  unoCurrentColor: string;
  unoPenaltyAccum: number;
  unoSaid: Record<string, boolean>;
}

/** ダウンロード／読み込みされるリプレイファイル本体の形 */
export interface ReplayFile {
  version: 1;
  roomId: string;
  players: ReplayPlayerInfo[];
  /** ゲーム開始直後（配り終わった直後）の状態。actionStartGame実行時に1回だけ保存される */
  initialState: ReplayFusionGameState;
  /** ゲーム開始から終了までの全操作の履歴 */
  actionLog: ReplayActionLogEntry[];
  /** リプレイファイルを保存（ダウンロード）した時刻 */
  savedAt: number;
}
