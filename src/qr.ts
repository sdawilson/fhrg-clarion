// A QR code, made here so that Clarion needs no extra library. Medium error correction, so a poster can be a little
// scuffed and still scan, and versions 1 to 10, which is far more than a link needs. Follows ISO/IEC 18004.

const EC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const ALIGNMENT = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MEDIUM = 0; // the two bits that say so in the format information

const times = (x: number, y: number) => {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
};

function errorCodewords(data: number[], degree: number): number[] {
  const divisor = new Array<number>(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { divisor[j] = times(divisor[j], root); if (j + 1 < degree) divisor[j] ^= divisor[j + 1]; }
    root = times(root, 2);
  }
  const out = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    divisor.forEach((d, i) => { out[i] ^= times(d, factor); });
  }
  return out;
}

const rawModules = (v: number) => {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; }
  return n;
};
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - EC_PER_BLOCK[v] * BLOCKS[v];

function withErrorCorrection(data: number[], v: number): number[] {
  const total = Math.floor(rawModules(v) / 8), blocks = BLOCKS[v], ec = EC_PER_BLOCK[v], short = blocks - (total % blocks), shortLength = Math.floor(total / blocks);
  const parts: number[][] = [];
  for (let i = 0, at = 0; i < blocks; i++) {
    const take = shortLength - ec + (i < short ? 0 : 1), block = data.slice(at, at + take);
    at += take;
    const codes = errorCodewords(block, ec);
    parts.push([...block, ...(i < short ? [-1] : []), ...codes]); // keeps the columns lined up as they're read across
  }
  const out: number[] = [];
  for (let i = 0; i < parts[0].length; i++) for (const p of parts) if (p[i] !== -1) out.push(p[i]);
  return out;
}

function encode(text: string): { v: number; codewords: number[] } {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1;
  while (v <= 10 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(v) * 8) v++;
  if (v > 10) throw new Error("That's too long for a QR code.");
  const bits: number[] = [];
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const room = dataCodewords(v) * 8;
  put(0, Math.min(4, room - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < room; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  return { v, codewords: withErrorCorrection(data, v) };
}

type Grid = { size: number; dark: boolean[][]; fixed: boolean[][] };
const mark = (g: Grid, x: number, y: number, on: boolean) => { g.dark[y][x] = on; g.fixed[y][x] = true; };

function drawFormat(g: Grid, mask: number) {
  const data = (MEDIUM << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412, bit = (i: number) => ((bits >>> i) & 1) === 1, s = g.size;
  for (let i = 0; i <= 5; i++) mark(g, 8, i, bit(i));
  mark(g, 8, 7, bit(6)); mark(g, 8, 8, bit(7)); mark(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) mark(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) mark(g, s - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) mark(g, 8, s - 15 + i, bit(i));
  mark(g, 8, s - 8, true);
}

function drawFixed(g: Grid, v: number) {
  const s = g.size;
  for (let i = 0; i < s; i++) { mark(g, 6, i, i % 2 === 0); mark(g, i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
    if (x >= 0 && x < s && y >= 0 && y < s) mark(g, x, y, d !== 2 && d !== 4);
  }
  const places = ALIGNMENT[v], last = places.length - 1;
  places.forEach((cx, i) => places.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  drawFormat(g, 0);
  if (v < 7) return;
  let rem = v;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (v << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1, a = s - 11 + (i % 3), b = Math.floor(i / 3);
    mark(g, a, b, on); mark(g, b, a, on);
  }
}

function drawData(g: Grid, codewords: number[]) {
  const s = g.size;
  let i = 0;
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < s; step++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? s - 1 - step : step;
      if (!g.fixed[y][x] && i < codewords.length * 8) { g.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
function flip(g: Grid, mask: number) {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fixed[y][x] && MASKS[mask](x, y)) g.dark[y][x] = !g.dark[y][x];
}

// The standard's four penalties: runs, blocks, shapes that look like the corner squares, and the balance of dark and light
function penalty(g: Grid): number {
  const s = g.size;
  let score = 0, dark = 0;
  const lines = [...g.dark, ...Array.from({ length: s }, (_, x) => g.dark.map((row) => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    const text = line.map((b) => (b ? "1" : "0")).join("");
    for (const shape of ["10111010000", "00001011101"]) for (let at = text.indexOf(shape); at !== -1; at = text.indexOf(shape, at + 1)) score += 40;
  }
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    if (g.dark[y][x]) dark++;
    if (x + 1 < s && y + 1 < s) { const c = g.dark[y][x]; if (c === g.dark[y][x + 1] && c === g.dark[y + 1][x] && c === g.dark[y + 1][x + 1]) score += 3; }
  }
  return score + Math.floor(Math.abs(dark * 20 - s * s * 10) / (s * s)) * 10;
}

/** Rows of 1s and 0s, with 1 for dark, and no quiet border: whatever draws it adds that. */
export function qrCode(text: string): string[] {
  const { v, codewords } = encode(text), size = v * 4 + 17;
  const g: Grid = { size, dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) };
  drawFixed(g, v);
  drawData(g, codewords);
  let best = 0, lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(g, mask); drawFormat(g, mask);
    const score = penalty(g);
    if (score < lowest) { lowest = score; best = mask; }
    flip(g, mask);
  }
  flip(g, best); drawFormat(g, best);
  return g.dark.map((row) => row.map((b) => (b ? "1" : "0")).join(""));
}
