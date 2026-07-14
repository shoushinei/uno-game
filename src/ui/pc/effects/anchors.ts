// ========================================
// 演出アンカーの座標解決
//
// 飛翔カード等の始点・終点を、画面上の実要素（席・場・山札・自分の手札）から
// 実測して「演出レイヤー（#pcg-effect-layer）相対の座標」で返す。
// ゾーンは同期のたびに再構築されうるため、座標は演出開始時に
// スナップショットとして取得し、以後は要素に依存しない。
// ========================================

export interface AnchorPoint {
  /** 演出レイヤー相対の中心X */
  x: number;
  /** 演出レイヤー相対の中心Y */
  y: number;
}

function layerRect(): DOMRect | null {
  const layer = document.getElementById('pcg-effect-layer');
  return layer ? layer.getBoundingClientRect() : null;
}

function centerOf(el: Element | null): AnchorPoint | null {
  const layer = layerRect();
  if (!layer || !el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - layer.left, y: r.top + r.height / 2 - layer.top };
}

/** 演出レイヤーの中央（フォールバック用） */
export function anchorCenter(): AnchorPoint {
  const layer = layerRect();
  if (!layer) return { x: 0, y: 0 };
  return { x: layer.width / 2, y: layer.height / 2 };
}

/** 席（他プレイヤー）。自分の場合は手札エリアを返す */
export function anchorSeat(playerId: string, myId: string): AnchorPoint {
  if (playerId === myId) return anchorOwnHand();
  return centerOf(document.querySelector(`[data-seat-id="${playerId}"] .pcg-avatar`)) ?? anchorCenter();
}

/** ①トランプの場 */
export function anchorTrumpField(): AnchorPoint {
  return centerOf(document.querySelector('.pcg-field-trump .pcg-field-cards')) ?? anchorCenter();
}

/** ②UNOの場 */
export function anchorUnoField(): AnchorPoint {
  return centerOf(document.querySelector('.pcg-field-uno .pcg-field-cards')) ?? anchorCenter();
}

/** 山札 */
export function anchorDeck(): AnchorPoint {
  return centerOf(document.querySelector('.pcg-deck')) ?? anchorCenter();
}

/** 自分の手札エリア（アクティブな行があればそこ、なければエリア全体） */
export function anchorOwnHand(): AnchorPoint {
  return (
    centerOf(document.querySelector('#pcg-own .pcg-hand-row.active .pcg-hand-cards')) ??
    centerOf(document.getElementById('pcg-own')) ??
    anchorCenter()
  );
}
