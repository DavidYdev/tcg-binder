/* Draws the app icons (two overlapping cards on the app's dark background)
   and writes them as PNG files, with no dependencies: shapes are drawn
   from signed distances, which also gives smooth edges, and the PNG
   encoder is the short block at the end.
   Usage: node tools/gen-icons.js   ->   icons/*.png                        */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const TOP = hex('#1b2431'), BOTTOM = hex('#0d1117');
const BLUE = hex('#3b6ed6'), YELLOW = hex('#ffcb05'), ART = hex('#d9a800'), DARK = hex('#131a23');

/* Signed distance from (px, py) to a rounded box centred at c, with half
   size h, corner radius r and rotation a (radians). Negative inside. */
function box(px, py, c, h, r, a) {
  const cos = Math.cos(-a), sin = Math.sin(-a);
  const x = (px - c[0]) * cos - (py - c[1]) * sin;
  const y = (px - c[0]) * sin + (py - c[1]) * cos;
  const qx = Math.abs(x) - (h[0] - r), qy = Math.abs(y) - (h[1] - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
/* Coverage of a pixel from its distance: 1 inside, 0 outside, a one-pixel
   ramp on the edge (wider when soft, for the shadow). */
const cover = (d, soft) => Math.min(1, Math.max(0, 0.5 - d / (soft || 1)));
/* A point offset along a rotated card's own axes. */
const along = (c, a, dx, dy) => [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];

/* scale: card size relative to the icon (smaller for maskable icons, whose
   corners the system may crop). round: transparent rounded corners. */
function draw(S, scale, round) {
  const px = Buffer.alloc(S * S * 4);
  const cardH = 0.60 * S * scale, cardW = cardH * 63 / 88;       // real card proportions
  const half = [cardW / 2, cardH / 2], rad = cardW * 0.09;
  const back = { c: [S * (0.5 - 0.08 * scale), S * (0.5 - 0.01 * scale)], a: -14 * Math.PI / 180 };
  const front = { c: [S * (0.5 + 0.07 * scale), S * (0.5 + 0.03 * scale)], a: 8 * Math.PI / 180 };
  const artC = along(front.c, front.a, 0, -half[1] * 0.22), artH = [half[0] * 0.80, half[1] * 0.36];
  const lines = [0.34, 0.54].map(f => along(front.c, front.a, 0, half[1] * f));
  const lineH = [half[0] * 0.62, cardH * 0.018];
  const shadowC = [front.c[0] + S * 0.012, front.c[1] + S * 0.018];

  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const X = x + 0.5, Y = y + 0.5;
    const t = y / (S - 1);
    let col = TOP.map((v, i) => v + (BOTTOM[i] - v) * t);
    const over = (c, a) => { if (a > 0) col = col.map((v, i) => v + (c[i] - v) * a); };
    over(BLUE, cover(box(X, Y, back.c, half, rad, back.a)));
    over([0, 0, 0], 0.45 * cover(box(X, Y, shadowC, half, rad, front.a), S * 0.03));
    over(YELLOW, cover(box(X, Y, front.c, half, rad, front.a)));
    over(ART, cover(box(X, Y, artC, artH, rad * 0.5, front.a)));
    lines.forEach(c => over(DARK, 0.35 * cover(box(X, Y, c, lineH, lineH[1], front.a))));
    const alpha = round ? cover(box(X, Y, [S / 2, S / 2], [S / 2, S / 2], S * 0.22, 0)) : 1;
    const o = (y * S + x) * 4;
    px[o] = Math.round(col[0]); px[o + 1] = Math.round(col[1]); px[o + 2] = Math.round(col[2]);
    px[o + 3] = Math.round(alpha * 255);
  }
  return px;
}

/* ---------- PNG encoder ---------- */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(S, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                  // 8 bits per channel, RGBA
  const stride = S * 4 + 1, raw = Buffer.alloc(stride * S);  // each row starts with filter byte 0
  for (let y = 0; y < S; y++) rgba.copy(raw, y * stride + 1, y * S * 4, (y + 1) * S * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
[
  ['icon-192.png', 192, 1.0, true],
  ['icon-512.png', 512, 1.0, true],
  ['maskable-512.png', 512, 0.8, false],        // content inside the central safe circle
  ['apple-touch-icon.png', 180, 0.9, false]     // iOS rounds the corners itself
].forEach(([name, size, scale, round]) => {
  const file = png(size, draw(size, scale, round));
  fs.writeFileSync(path.join(OUT, name), file);
  console.log(name + ': ' + Math.round(file.length / 1024) + ' KB');
});
