// One-off helper that generates placeholder PWA icons (solid-color PNGs with
// a rounded "R" glyph rendered as a simple block pattern). No external image
// libraries are required: PNGs are hand-assembled from raw RGBA pixels and
// deflated with Node's built-in zlib.
//
// Run with: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const BG = [15, 23, 42, 255]; // slate-900 background (matches theme color)
const FG = [56, 189, 248, 255]; // sky-400 foreground glyph

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([lenBuf, body, crcBuf]);
}

function makePng(size) {
  // Draw a centered "R"-ish block using a 5x7 bitmap font scaled to the canvas.
  const glyph = [
    '1111.',
    '1..1.',
    '1..1.',
    '1111.',
    '1.1..',
    '1..1.',
    '1..1.',
  ];
  const cols = 5;
  const rows = 7;
  const cell = Math.floor(size / 10);
  const glyphW = cols * cell;
  const glyphH = rows * cell;
  const offX = Math.floor((size - glyphW) / 2);
  const offY = Math.floor((size - glyphH) / 2);

  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // no filter
    for (let x = 0; x < size; x++) {
      let color = BG;
      const gx = Math.floor((x - offX) / cell);
      const gy = Math.floor((y - offY) / cell);
      if (gx >= 0 && gx < cols && gy >= 0 && gy < rows && glyph[gy][gx] === '1') {
        color = FG;
      }
      raw[p++] = color[0];
      raw[p++] = color[1];
      raw[p++] = color[2];
      raw[p++] = color[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['maskable-icon-512x512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of targets) {
  writeFileSync(join(publicDir, name), makePng(size));
  console.log(`wrote ${name} (${size}x${size})`);
}

// Simple SVG favicon.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0f172a"/><text x="16" y="23" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#38bdf8">R</text></svg>\n`;
writeFileSync(join(publicDir, 'favicon.svg'), favicon);
console.log('wrote favicon.svg');
