import { TERRAIN, WORLD } from "./config";

/**
 * Deterministic procedural heightfield: rolling hills, ridged mountain ranges,
 * low valleys, terraced mesas with cliff faces, and winding ravines whose depth
 * fades in and out so there are always crossings. Generated once and sampled
 * bilinearly by both physics and rendering.
 */
export interface TerrainGrid {
  cols: number;
  rows: number;
  cell: number;
  height: Float32Array;
  /** 0..1, how deep inside a ravine floor each sample is (for rendering) */
  ravine: Float32Array;
  minHeight: number;
  maxHeight: number;
}

function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Each octave is rotated so value-noise lattice artefacts don't line up.
const ROT_C = Math.cos(0.9);
const ROT_S = Math.sin(0.9);

function fbm(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, y, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    const nx = (x * ROT_C - y * ROT_S) * 2.03;
    y = (x * ROT_S + y * ROT_C) * 2.03;
    x = nx + 17.3;
  }
  return sum / norm;
}

/** Ridged multifractal-ish noise in [0, 1], 1 along sharp ridge lines. */
function ridged(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x, y, seed + o * 131) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    const nx = (x * ROT_C - y * ROT_S) * 2.1;
    y = (x * ROT_S + y * ROT_C) * 2.1;
    x = nx + 5.7;
  }
  return sum / norm;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const sampleOut = { h: 0, ravine: 0 };

function sampleRaw(x: number, y: number, out: { h: number; ravine: number }): void {
  const T = TERRAIN;
  const s = T.seed;

  let h = T.baseHeight + (fbm(x / T.hillScale, y / T.hillScale, 4, s) - 0.5) * 2 * T.hillAmp;

  // Large regions decide where mountains rise and valleys sink.
  const region = fbm(x / T.regionScale, y / T.regionScale, 2, s + 11);
  const mountains = smoothstep(0.47, 0.66, region);
  if (mountains > 0) {
    const r = ridged(x / T.mountainScale, y / T.mountainScale, 3, s + 23);
    h += mountains * r * r * T.mountainAmp;
  }
  h -= smoothstep(0.42, 0.26, region) * T.valleyDepth;

  // Terraced mesas: quantise height into steps with short, sheer risers. The
  // mask fades in and out, so every cliff band has ramps around its ends.
  const cliffs = smoothstep(0.54, 0.66, fbm(x / T.cliffScale, y / T.cliffScale, 2, s + 37));
  if (cliffs > 0) {
    const f = h / T.terraceStep;
    const i = Math.floor(f);
    const stepped = (i + smoothstep(1 - T.terraceRise, 1, f - i)) * T.terraceStep;
    h += (stepped - h) * cliffs;
  }

  // Ravines follow the mid-line of a noise field; their depth is modulated so
  // they come and go along their length.
  const line = Math.abs(fbm(x / T.ravineScale, y / T.ravineScale, 2, s + 53) - 0.5) * 2;
  let ravine = 0;
  if (line < T.ravineWidth) {
    const depth = smoothstep(0.38, 0.62, noise(x / 700, y / 700, s + 71));
    ravine = smoothstep(T.ravineWidth, T.ravineWidth * 0.72, line) * depth;
    h -= ravine * T.ravineDepth;
  }

  // Keep the spawn area open and level.
  const d = Math.hypot(x - WORLD.width / 2, y - WORLD.height / 2);
  const flat = smoothstep(T.spawnRadius + T.spawnBlend, T.spawnRadius, d);
  if (flat > 0) {
    h += (T.baseHeight - h) * flat;
    ravine *= 1 - flat;
  }

  out.h = Math.max(0, h);
  out.ravine = ravine;
}

let grid: TerrainGrid | null = null;

export function terrainGrid(): TerrainGrid {
  if (grid) return grid;
  const cell = TERRAIN.cell;
  const cols = Math.ceil(WORLD.width / cell) + 1;
  const rows = Math.ceil(WORLD.height / cell) + 1;
  const height = new Float32Array(cols * rows);
  const ravine = new Float32Array(cols * rows);
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      sampleRaw(i * cell, j * cell, sampleOut);
      const h = Number.isFinite(sampleOut.h) ? sampleOut.h : TERRAIN.baseHeight;
      height[j * cols + i] = h;
      ravine[j * cols + i] = sampleOut.ravine;
      if (h < minHeight) minHeight = h;
      if (h > maxHeight) maxHeight = h;
    }
  }
  grid = { cols, rows, cell, height, ravine, minHeight, maxHeight };
  return grid;
}

/** Bilinear terrain height at a world position (clamped to the arena). */
export function heightAt(x: number, y: number): number {
  const g = grid ?? terrainGrid();
  let fx = x / g.cell;
  let fy = y / g.cell;
  if (!(fx > 0)) fx = 0;
  else if (fx > g.cols - 1.001) fx = g.cols - 1.001;
  if (!(fy > 0)) fy = 0;
  else if (fy > g.rows - 1.001) fy = g.rows - 1.001;
  const ix = fx | 0;
  const iy = fy | 0;
  const tx = fx - ix;
  const ty = fy - iy;
  const k = iy * g.cols + ix;
  const h = g.height;
  const a = h[k];
  const b = h[k + 1];
  const c = h[k + g.cols];
  const d = h[k + g.cols + 1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** Terrain gradient (dh/dx, dh/dy) by central differences. */
export function gradientAt(x: number, y: number, out: { x: number; y: number }, e = 4): void {
  out.x = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
  out.y = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
}
