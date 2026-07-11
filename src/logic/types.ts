// ========================================
// ゲーム状態の共通型定義
//
// game-rules.ts をはじめ、複数のファイルが同じ「融合ゲーム状態」の形を
// 扱うため、ここに一箇所だけ定義する。
// replay/types.ts の ReplayFusionGameState は、この GameState を
// そのまま再利用する（型を2箇所で別々に定義しない）。
// ========================================
import type { TrumpCard } from './trump-logic';

export interface Player {
  id: string;
  name: string;
}

export interface UnoCard {
  c: string; // 色（red/blue/green/yellow/w）
  t: string; // カード種別（num/skip/rev/d2/w/w4）
  v: string; // 表示上の値
}

export interface Ranking {
  id: string;
  name: string;
}

export interface GameState {
  order: string[];
  ci: number;
  dir: number;
  phase: 'trump' | 'uno';
  rankings: Ranking[];

  trumpHands: Record<string, TrumpCard[]>;
  trumpField: TrumpCard[];
  trumpFieldMeta: unknown;
  trumpFieldOwner: string | null;
  trumpRevolution: boolean;
  trumpElevenBack: boolean;
  trumpSuitLock: string[] | null;
  trumpEffect: unknown;
  hasParent: string | null;

  unoHands: Record<string, UnoCard[]>;
  unoDrawPile: UnoCard[];
  unoDiscardPile: UnoCard[];
  unoCurrentColor: string;
  unoPenaltyAccum: number;
  unoSaid: Record<string, boolean>;
}