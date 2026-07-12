// ========================================
// 席の配置計算（純粋関数・DOM非依存・テスト対象）
//
// テーブル（楕円）の上弧に、自分以外のプレイヤーを等間隔に配置する。
// 自分はテーブルに座らず、画面下部の手札エリアが「自分の席」。
// ========================================

export interface SeatPosition {
  id: string;
  /** テーブル領域に対する中心X座標（%） */
  xPercent: number;
  /** テーブル領域に対する中心Y座標（%） */
  yPercent: number;
}

/**
 * 自分以外のプレイヤーを「自分の次の手番から順に」並べた配列を返す。
 *
 * 席は order の並び（＝手番の順）を自分基準に回転させたもの。
 * 自分の次のプレイヤーが左端、そこから手番順に右へ並ぶ。
 * リバースが起きても席は動かさない（動かすと混乱するため。
 * 回転方向はステータスバーの ⟳/⟲ 表示で伝える）。
 *
 * @param order    現在の手番順（g.order。上がったプレイヤーは含まれない）
 * @param allIds   表示すべき全プレイヤーID（上がり済み含む。players配列由来）
 * @param myId     自分のID
 */
export function othersInTurnOrder(order: string[], allIds: string[], myId: string): string[] {
  const myIdx = order.indexOf(myId);
  const rotated: string[] = [];

  if (myIdx !== -1) {
    // 自分の次の手番から順に一周
    for (let i = 1; i < order.length; i++) {
      rotated.push(order[(myIdx + i) % order.length]!);
    }
  } else {
    // 自分が上がり済みで order にいない場合は order をそのまま
    rotated.push(...order.filter(id => id !== myId));
  }

  // 上がり済み（order にいない）プレイヤーを末尾（右端側）に追加
  for (const id of allIds) {
    if (id !== myId && !rotated.includes(id)) rotated.push(id);
  }
  return rotated;
}

/**
 * N人分の席座標（%）を計算する。
 *
 * テーブル領域の上弧に沿って左→右へ等間隔に並べる。
 * 角度は 180°（左端）〜 0°（右端）の範囲を使い、人数が少ないときは
 * 端に寄りすぎないよう内側に詰める。
 */
export function seatPositions(ids: string[]): SeatPosition[] {
  const n = ids.length;
  if (n === 0) return [];

  // 楕円弧のパラメータ（テーブル領域に対する%）
  const centerX = 50;
  const centerY = 62;   // 楕円の中心はやや下（席は上弧に乗る）
  const radiusX = 42;
  const radiusY = 50;

  // 1人なら真上、複数なら左右対称に等間隔
  // 使う角度範囲: 人数が多いほど広げる（最大 170°〜10°）
  const spread = Math.min(160, 40 * (n - 1));
  const startDeg = 90 + spread / 2;

  return ids.map((id, i) => {
    const deg = n === 1 ? 90 : startDeg - (spread / (n - 1)) * i;
    const rad = (deg * Math.PI) / 180;
    return {
      id,
      xPercent: centerX + radiusX * Math.cos(rad),
      yPercent: centerY - radiusY * Math.sin(rad),
    };
  });
}
