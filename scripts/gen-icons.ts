import './load-env';

/**
 * Generates RailDrop's app icons.
 *
 * Written as a generator rather than checked-in binaries so the mark is defined
 * once, in code, and every size is guaranteed consistent. A minimal PNG encoder
 * (zlib + CRC32) avoids pulling an image library into the dependency tree for
 * five files that never change.
 *
 * The mark is the route line from the UI: two station dots joined by a track,
 * with the destination dot open — the same visual idea as <RouteLine />.
 *
 *   npm run gen:icons
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

type RGBA = [number, number, number, number];

const INK: RGBA = [0x14, 0x12, 0x0f, 255];
const PAPER: RGBA = [0xfb, 0xfa, 0xf8, 255];
const RUST: RGBA = [0xd8, 0x5a, 0x28, 255];

// ─── Minimal PNG encoder ─────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

class Canvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly size: number,
    background: RGBA,
  ) {
    this.pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) this.set(i, background, 1);
  }

  private set(index: number, [r, g, b, a]: RGBA, alpha: number): void {
    const o = index * 4;
    const existing = this.pixels;
    const src = alpha * (a / 255);
    const dstA = (existing[o + 3] as number) / 255;
    const outA = src + dstA * (1 - src);
    if (outA === 0) return;
    for (let c = 0; c < 3; c += 1) {
      const s = [r, g, b][c] as number;
      const d = existing[o + c] as number;
      existing[o + c] = Math.round((s * src + d * dstA * (1 - src)) / outA);
    }
    existing[o + 3] = Math.round(outA * 255);
  }

  /** Anti-aliased by 3x3 supersampling of a coverage predicate. */
  fill(colour: RGBA, covers: (x: number, y: number) => boolean): void {
    const { size } = this;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        let hits = 0;
        for (let sy = 0; sy < 3; sy += 1) {
          for (let sx = 0; sx < 3; sx += 1) {
            if (covers(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits += 1;
          }
        }
        if (hits > 0) this.set(y * size + x, colour, hits / 9);
      }
    }
  }
}

function roundedSquare(size: number, radius: number) {
  return (x: number, y: number) => {
    const cx = Math.min(Math.max(x, radius), size - radius);
    const cy = Math.min(Math.max(y, radius), size - radius);
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  };
}

function disc(cx: number, cy: number, r: number) {
  return (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function ring(cx: number, cy: number, r: number, thickness: number) {
  return (x: number, y: number) => {
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    return d <= r && d >= r - thickness;
  };
}

/** Horizontal dashed track, matching the .rd-rail motif. */
function track(x0: number, x1: number, cy: number, thickness: number, dash: number, gap: number) {
  return (x: number, y: number) => {
    if (x < x0 || x > x1) return false;
    if (Math.abs(y - cy) > thickness / 2) return false;
    return (x - x0) % (dash + gap) < dash;
  };
}

function drawMark(size: number, opts: { background: RGBA; padded: boolean }): Canvas {
  const canvas = new Canvas(size, [0, 0, 0, 0]);
  const u = size / 100;

  if (opts.padded) {
    canvas.fill(opts.background, roundedSquare(size, 22 * u));
  } else {
    canvas.fill(opts.background, () => true);
  }

  const cy = size / 2;
  const left = 24 * u;
  const right = size - 24 * u;

  canvas.fill(RUST, track(left + 7 * u, right - 7 * u, cy, 3.5 * u, 6 * u, 5 * u));
  canvas.fill(RUST, disc(left, cy, 7.5 * u));
  canvas.fill(RUST, ring(right, cy, 7.5 * u, 3.2 * u));

  return canvas;
}

// ─── Emit ────────────────────────────────────────────────────────────────────

const PUBLIC = join(process.cwd(), 'public');
mkdirSync(PUBLIC, { recursive: true });

const outputs: Array<{ file: string; size: number; background: RGBA; padded: boolean }> = [
  { file: 'icon-192.png', size: 192, background: INK, padded: true },
  { file: 'icon-512.png', size: 512, background: INK, padded: true },
  // Maskable icons are cropped to a circle by some launchers, so they need a
  // full-bleed background rather than a rounded card.
  { file: 'icon-maskable-512.png', size: 512, background: INK, padded: false },
  { file: 'apple-touch-icon.png', size: 180, background: INK, padded: false },
  { file: 'favicon-32.png', size: 32, background: PAPER, padded: false },
];

for (const output of outputs) {
  const canvas = drawMark(output.size, { background: output.background, padded: output.padded });
  writeFileSync(join(PUBLIC, output.file), encodePng(output.size, output.size, canvas.pixels));
  console.log(`  wrote public/${output.file} (${output.size}x${output.size})`);
}

// An SVG for anywhere that prefers vector (browser tab, README, og:image base).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="RailDrop">
  <rect width="100" height="100" rx="22" fill="#14120f"/>
  <line x1="31" y1="50" x2="69" y2="50" stroke="#d85a28" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="6 5"/>
  <circle cx="24" cy="50" r="7.5" fill="#d85a28"/>
  <circle cx="76" cy="50" r="6" fill="none" stroke="#d85a28" stroke-width="3.2"/>
</svg>
`;
writeFileSync(join(PUBLIC, 'icon.svg'), svg);
console.log('  wrote public/icon.svg');
console.log('\nIcons generated.');
