// ========================================
// PWA用アイコン生成スクリプト（依存パッケージなし）
//
//   node tools/make-icons.mjs
//
// public/icons/ 配下の PNG をすべて作り直す。デザインを変えたいときは
// 下の PALETTE と drawIcon() を編集して再実行する。
//
// 仕組み: 出力サイズの SS 倍で描いてから縮小する（スーパーサンプリング）。
// これで外部ライブラリなしにアンチエイリアスが効く。PNG は zlib だけで
// 手書きエンコードしている（Node 標準の zlib は PNG の圧縮方式と同じ）。
// ========================================
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SS = 4; // スーパーサンプリング倍率

// ---- 配色（game-pc.css の緑フェルト＋木縁のテーマに合わせる） ----
const PALETTE = {
  feltInner: [0x24, 0x5a, 0x45],
  feltOuter: [0x0a, 0x1a, 0x14],
  cardFace:  [0xf7, 0xf3, 0xe6],
  cardEdge:  [0xc9, 0xc0, 0xab],
  spade:     [0x14, 0x18, 0x22],
  unoRed:    [0xd6, 0x29, 0x3e],
  unoEdge:   [0xa5, 0x1b, 0x2c],
  white:     [0xff, 0xff, 0xff],
};

// ============================================================
// ラスタライザ（正規化座標 0..1 で受け取り、N×N のバッファに描く）
// ============================================================
function createSurface(n) {
  return { n, buf: new Uint8ClampedArray(n * n * 3) };
}

function blend(sf, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= sf.n || y >= sf.n) return;
  const i = (y * sf.n + x) * 3;
  sf.buf[i]     = sf.buf[i]     * (1 - alpha) + color[0] * alpha;
  sf.buf[i + 1] = sf.buf[i + 1] * (1 - alpha) + color[1] * alpha;
  sf.buf[i + 2] = sf.buf[i + 2] * (1 - alpha) + color[2] * alpha;
}

/** 正規化座標の矩形範囲を走査して inside(u,v) が真の画素を塗る */
function fill(sf, bbox, inside, color, alpha = 1) {
  const x0 = Math.max(0, Math.floor(bbox[0] * sf.n));
  const y0 = Math.max(0, Math.floor(bbox[1] * sf.n));
  const x1 = Math.min(sf.n - 1, Math.ceil(bbox[2] * sf.n));
  const y1 = Math.min(sf.n - 1, Math.ceil(bbox[3] * sf.n));
  for (let y = y0; y <= y1; y++) {
    const v = (y + 0.5) / sf.n;
    for (let x = x0; x <= x1; x++) {
      const u = (x + 0.5) / sf.n;
      if (inside(u, v)) blend(sf, x, y, color, alpha);
    }
  }
}

/** 角丸矩形の符号付き距離（0以下なら内側） */
function sdRoundRect(x, y, hw, hh, r) {
  const qx = Math.abs(x) - hw + r;
  const qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 点を (cx,cy) 中心・角度 ang のローカル座標へ移す */
function toLocal(u, v, cx, cy, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const dx = u - cx, dy = v - cy;
  return [dx * c - dy * s, dx * s + dy * c];
}

function pointInPolygon(x, y, pts) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ============================================================
// 各パーツの描画
// ============================================================

/** 背景（中央が明るい緑フェルト） */
function drawFelt(sf) {
  for (let y = 0; y < sf.n; y++) {
    const v = (y + 0.5) / sf.n;
    for (let x = 0; x < sf.n; x++) {
      const u = (x + 0.5) / sf.n;
      // 中央やや上を光源に見立てる
      const d = Math.min(1, Math.hypot(u - 0.5, v - 0.42) / 0.72);
      const t = d * d * (3 - 2 * d); // smoothstep
      const i = (y * sf.n + x) * 3;
      for (let c = 0; c < 3; c++) {
        sf.buf[i + c] = PALETTE.feltInner[c] * (1 - t) + PALETTE.feltOuter[c] * t;
      }
    }
  }
}

/** 影（角丸矩形を少しずつ広げながら薄く重ねてぼかしの代わりにする） */
function drawShadow(sf, cx, cy, ang, hw, hh, r) {
  const ox = 0.006, oy = 0.012;
  for (let k = 5; k >= 1; k--) {
    const grow = k * 0.008;
    const bb = [cx - hw - grow - 0.05, cy - hh - grow - 0.05, cx + hw + grow + 0.05, cy + hh + grow + 0.05];
    fill(sf, bb, (u, v) => {
      const [x, y] = toLocal(u, v, cx + ox, cy + oy, ang);
      return sdRoundRect(x, y, hw + grow, hh + grow, r + grow) <= 0;
    }, [0, 0, 0], 0.10);
  }
}

/** カード本体（縁取り付き） */
function drawCard(sf, cx, cy, ang, hw, hh, r, face, edge) {
  const bb = [cx - hw - hh, cy - hh - hw, cx + hw + hh, cy + hh + hw];
  fill(sf, bb, (u, v) => {
    const [x, y] = toLocal(u, v, cx, cy, ang);
    return sdRoundRect(x, y, hw, hh, r) <= 0;
  }, edge);
  const b = hw * 0.075; // 縁の太さ
  fill(sf, bb, (u, v) => {
    const [x, y] = toLocal(u, v, cx, cy, ang);
    return sdRoundRect(x, y, hw - b, hh - b, r * 0.8) <= 0;
  }, face);
}

/** スペード（三角＋左右の丸＋台形の軸） */
function drawSpade(sf, cx, cy, ang, s, color) {
  const bb = [cx - s, cy - s, cx + s, cy + s];
  const tri = [[0, -0.54 * s], [-0.52 * s, 0.16 * s], [0.52 * s, 0.16 * s]];
  const stem = [[-0.07 * s, 0.05 * s], [0.07 * s, 0.05 * s], [0.26 * s, 0.50 * s], [-0.26 * s, 0.50 * s]];
  const lobeR = 0.28 * s;
  fill(sf, bb, (u, v) => {
    const [x, y] = toLocal(u, v, cx, cy, ang);
    if (pointInPolygon(x, y, tri)) return true;
    if (pointInPolygon(x, y, stem)) return true;
    if (Math.hypot(x + 0.25 * s, y - 0.11 * s) <= lobeR) return true;
    if (Math.hypot(x - 0.25 * s, y - 0.11 * s) <= lobeR) return true;
    return false;
  }, color);
}

/** UNOカードの白い楕円 */
function drawOval(sf, cx, cy, ang, a, b, color) {
  const m = Math.max(a, b);
  fill(sf, [cx - m, cy - m, cx + m, cy + m], (u, v) => {
    const [x, y] = toLocal(u, v, cx, cy, ang);
    return (x * x) / (a * a) + (y * y) / (b * b) <= 1;
  }, color);
}

/** 数字の「1」（縦棒＋左上のはね＋台座） */
function drawOne(sf, cx, cy, ang, h, color) {
  const bb = [cx - h, cy - h, cx + h, cy + h];
  const stem = [[-0.11 * h, -0.50 * h], [0.11 * h, -0.50 * h], [0.11 * h, 0.36 * h], [-0.11 * h, 0.36 * h]];
  const flag = [[-0.11 * h, -0.50 * h], [-0.11 * h, -0.22 * h], [-0.34 * h, -0.06 * h], [-0.34 * h, -0.30 * h]];
  const base = [[-0.30 * h, 0.36 * h], [0.30 * h, 0.36 * h], [0.30 * h, 0.52 * h], [-0.30 * h, 0.52 * h]];
  fill(sf, bb, (u, v) => {
    const [x, y] = toLocal(u, v, cx, cy, ang);
    return pointInPolygon(x, y, stem) || pointInPolygon(x, y, flag) || pointInPolygon(x, y, base);
  }, color);
}

/**
 * アイコン一枚分の絵。
 * @param scale 図柄の大きさ。1.0 でキャンバスいっぱい。マスカブル用は
 *              安全領域(中央80%)に収めたいので小さくする。
 */
function drawIcon(sf, scale) {
  drawFelt(sf);

  const hw = 0.148 * scale;  // カードの半幅
  const hh = 0.212 * scale;  // カードの半高
  const r  = 0.030 * scale;  // 角丸
  const dx = 0.098 * scale;  // 2枚のずらし幅
  const cy = 0.500;
  const angA = -0.25, angB = 0.22; // ±13〜14°くらい

  // 奥（トランプ：スペード）
  // ★スペードはカード中央に置くと手前の赤カードにほぼ隠れる。
  //   カードのローカル座標で左上に寄せて、露出する側に描く
  const sOff = [-0.055 * scale, -0.030 * scale];
  const ca = Math.cos(angA), sa = Math.sin(angA);
  const spx = 0.5 - dx + (sOff[0] * ca - sOff[1] * sa);
  const spy = cy + (sOff[0] * sa + sOff[1] * ca);
  drawShadow(sf, 0.5 - dx, cy, angA, hw, hh, r);
  drawCard(sf, 0.5 - dx, cy, angA, hw, hh, r, PALETTE.cardFace, PALETTE.cardEdge);
  drawSpade(sf, spx, spy, angA, hw * 0.80, PALETTE.spade);

  // 手前（UNO：赤カード）
  drawShadow(sf, 0.5 + dx, cy, angB, hw, hh, r);
  drawCard(sf, 0.5 + dx, cy, angB, hw, hh, r, PALETTE.unoRed, PALETTE.unoEdge);
  drawOval(sf, 0.5 + dx, cy, angB - 0.52, hh * 0.60, hw * 0.62, PALETTE.white);
  drawOne(sf, 0.5 + dx, cy, angB, hw * 0.95, PALETTE.unoRed);
}

// ============================================================
// 縮小と PNG 出力
// ============================================================
function downsample(sf, size) {
  const out = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * sf.n + (x * SS + sx)) * 3;
          r += sf.buf[i]; g += sf.buf[i + 1]; b += sf.buf[i + 2];
        }
      }
      const n = SS * SS, o = (y * size + x) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgb, size) {
  // 各行の先頭にフィルタ種別バイト(0=なし)を付ける
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // ビット深度
  ihdr[9] = 2;  // カラータイプ: トゥルーカラー(RGB)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================
const TARGETS = [
  { file: 'icon-192.png',          size: 192, scale: 1.00 },
  { file: 'icon-512.png',          size: 512, scale: 1.00 },
  // マスカブル: Android が円などに切り抜くので図柄を中央80%に収める
  { file: 'icon-maskable-512.png', size: 512, scale: 0.74 },
  { file: 'apple-touch-icon.png',  size: 180, scale: 1.00 },
  { file: 'favicon-32.png',        size:  32, scale: 1.10 },
];

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const t of TARGETS) {
  const sf = createSurface(t.size * SS);
  drawIcon(sf, t.scale);
  const png = encodePng(downsample(sf, t.size), t.size);
  fs.writeFileSync(path.join(OUT_DIR, t.file), png);
  console.log(`${t.file}  ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)}KB`);
}
console.log('done ->', OUT_DIR);
