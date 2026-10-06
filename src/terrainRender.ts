import { TERRAIN, WORLD } from "./game/config";
import { heightAt, terrainGrid } from "./game/terrain";

/** World px per texel of the baked terrain image. */
export const TERRAIN_TEXEL = 2;

type Rgb = [number, number, number];

// Height-banded palette: lush lowlands, dry upland grass, rock, snowcaps.
const BANDS: ReadonlyArray<readonly [number, Rgb]> = [
  [0, [70, 122, 66]],
  [70, [86, 146, 76]],
  [140, [104, 158, 82]],
  [210, [136, 160, 90]],
  [270, [140, 130, 102]],
  [360, [124, 116, 110]],
  [420, [232, 238, 242]],
];
const ROCK: Rgb = [112, 98, 84];
const GRAVEL: Rgb = [96, 86, 74];

function band(h: number, out: Rgb): void {
  let i = 0;
  while (i < BANDS.length - 2 && h > BANDS[i + 1][0]) i++;
  const [h0, c0] = BANDS[i];
  const [h1, c1] = BANDS[i + 1];
  const t = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
  out[0] = c0[0] + (c1[0] - c0[0]) * t;
  out[1] = c0[1] + (c1[1] - c0[1]) * t;
  out[2] = c0[2] + (c1[2] - c0[2]) * t;
}

function mix(out: Rgb, c: Rgb, t: number): void {
  out[0] += (c[0] - out[0]) * t;
  out[1] += (c[1] - out[1]) * t;
  out[2] += (c[2] - out[2]) * t;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// light from the upper left, matching the drop shadows on airborne cars
const LX = -0.55;
const LY = -0.65;
const LZ = 0.52;
const CONTOUR = 30;

/**
 * Bakes the whole arena into one hill-shaded image (height colours, rock on
 * steep faces, contour lines, gravel ravine floors, trees and boulders). The
 * work is spread over a few frames with `step`; drawing it is a single blit.
 */
export class TerrainBaker {
  readonly canvas: HTMLCanvasElement;
  done = false;
  private ctx: CanvasRenderingContext2D | null;
  private img: ImageData | null = null;
  private tw: number;
  private th: number;
  private row = 0;
  private above: Float32Array;
  private cur: Float32Array;
  private below: Float32Array;

  constructor() {
    const s = TERRAIN_TEXEL;
    this.tw = Math.ceil(WORLD.width / s);
    this.th = Math.ceil(WORLD.height / s);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.tw;
    this.canvas.height = this.th;
    this.ctx = this.canvas.getContext("2d");
    this.above = new Float32Array(this.tw);
    this.cur = new Float32Array(this.tw);
    this.below = new Float32Array(this.tw);
    if (!this.ctx) this.done = true;
  }

  /** Bake for up to `budgetMs`; returns true once the image is complete. */
  step(budgetMs: number): boolean {
    if (this.done || !this.ctx) return true;
    const t0 = performance.now();
    if (!this.img) {
      terrainGrid();
      this.img = this.ctx.createImageData(this.tw, this.th);
      this.fillRow(this.above, -1);
      this.fillRow(this.cur, 0);
    }
    const start = this.row;
    while (this.row < this.th) {
      this.shadeRow(this.row);
      this.row++;
      if ((this.row & 15) === 0 && performance.now() - t0 > budgetMs) break;
    }
    this.ctx.putImageData(this.img, 0, 0, 0, start, this.tw, this.row - start);
    if (this.row >= this.th) {
      decorate(this.ctx);
      this.img = null;
      this.done = true;
    }
    return this.done;
  }

  private fillRow(row: Float32Array, j: number): void {
    const s = TERRAIN_TEXEL;
    const y = (Math.max(0, Math.min(this.th - 1, j)) + 0.5) * s;
    for (let i = 0; i < this.tw; i++) row[i] = heightAt((i + 0.5) * s, y);
  }

  private shadeRow(j: number): void {
    const grid = terrainGrid();
    const px = this.img!.data;
    const s = TERRAIN_TEXEL;
    const tw = this.tw;
    const rav = grid.ravine;
    const cols = grid.cols;
    const c: Rgb = [0, 0, 0];
    this.fillRow(this.below, j + 1);
    const { above, cur, below } = this;
    const y = (j + 0.5) * s;
    const ravRow = Math.round(y / grid.cell) * cols;
    for (let i = 0; i < tw; i++) {
      const x = (i + 0.5) * s;
      const h = cur[i];
      const gx = (cur[i < tw - 1 ? i + 1 : i] - cur[i > 0 ? i - 1 : i]) / (2 * s);
      const gy = (below[i] - above[i]) / (2 * s);
      const slope = Math.sqrt(gx * gx + gy * gy);

      band(h, c);
      const r = rav[ravRow + Math.round(x / grid.cell)] ?? 0;
      if (r > 0.6) mix(c, GRAVEL, Math.min(1, (r - 0.6) * 3));
      if (slope > 0.7) mix(c, ROCK, Math.min(1, (slope - 0.7) / 0.9));

      // exaggerated normals read better from straight above
      const nx = -gx * 1.6;
      const ny = -gy * 1.6;
      const lit = (nx * LX + ny * LY + LZ) / Math.sqrt(nx * nx + ny * ny + 1);
      let k = Math.max(0.35, Math.min(1.35, 0.62 + 0.75 * lit));
      // contour lines on gentle ground: distance to the nearest isoline in px
      if (slope > 0.02 && slope < 1.2) {
        const f = h / CONTOUR;
        const d = (Math.min(f - Math.floor(f), Math.ceil(f) - f) * CONTOUR) / slope;
        if (d < 1.1) k *= 0.88;
      }
      // fine grain so flat areas don't look plastic
      const grain = (((i * 73856093) ^ (j * 19349663)) >>> 0) % 13;
      k *= 0.97 + grain * 0.005;

      const o = (j * tw + i) * 4;
      px[o] = c[0] * k;
      px[o + 1] = c[1] * k;
      px[o + 2] = c[2] * k;
      px[o + 3] = 255;
    }
    this.above = cur;
    this.cur = below;
    this.below = above;
  }
}

function slopeAt(x: number, y: number): number {
  const e = 6;
  const dx = heightAt(x + e, y) - heightAt(x - e, y);
  const dy = heightAt(x, y + e) - heightAt(x, y - e);
  return Math.sqrt(dx * dx + dy * dy) / (2 * e);
}

/** Scatter deterministic trees on gentle grass and boulders on rocky ground. */
function decorate(ctx: CanvasRenderingContext2D): void {
  const rand = mulberry32(TERRAIN.seed * 7 + 3);
  const s = TERRAIN_TEXEL;
  const cx = WORLD.width / 2;
  const cy = WORLD.height / 2;
  ctx.save();
  ctx.scale(1 / s, 1 / s);
  for (let n = 0; n < 14000; n++) {
    const x = 20 + rand() * (WORLD.width - 40);
    const y = 20 + rand() * (WORLD.height - 40);
    const roll = rand();
    const size = 0.7 + rand() * 0.6;
    const h = heightAt(x, y);
    const sl = slopeAt(x, y);
    // groves cluster where a cheap hash of a coarse cell says so
    const cell = (Math.floor(x / 260) * 92821 + Math.floor(y / 260) * 68917) % 7;
    const grove = cell < 3 ? 1 : 0.12;
    if (h > 40 && h < 260 && sl < 0.35 && roll < grove && Math.hypot(x - cx, y - cy) > 140) {
      const r = 6 * size;
      ctx.fillStyle = "rgba(20, 40, 20, 0.35)";
      ctx.beginPath();
      ctx.ellipse(x + r * 0.6, y + r * 0.7, r, r * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = h > 190 ? "#3f6b3a" : "#2f6a33";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(160, 210, 120, 0.35)";
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (sl > 0.45 && sl < 1.4 && roll < 0.25) {
      const r = 3.5 * size;
      ctx.fillStyle = "rgba(30, 24, 18, 0.35)";
      ctx.beginPath();
      ctx.ellipse(x + r * 0.5, y + r * 0.6, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#8d8476";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
