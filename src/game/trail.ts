import { WORLD } from "./config";
import type { Trail } from "./types";

/**
 * Return enough samples to represent the complete spacing of a train with
 * `carCount` cars, plus the seed margin used by createTrain.
 */
export function trailCapacityForCars(carCount: number): number {
  const trainLength = (carCount + 2) * WORLD.carSpacing;
  return Math.ceil(trainLength / WORLD.trailStep) + 2;
}

export function createTrail(capacity = trailCapacityForCars(WORLD.maxCars)): Trail {
  return {
    xs: new Float32Array(capacity),
    ys: new Float32Array(capacity),
    ss: new Float32Array(capacity),
    head: -1,
    count: 0,
  };
}

/** Lay down a straight trail behind (x, y) facing `angle`, so a fresh train has cars in a line. */
export function seedTrail(t: Trail, x: number, y: number, angle: number, length: number): void {
  t.head = -1;
  t.count = 0;
  const steps = Math.ceil(length / WORLD.trailStep);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let i = steps; i >= 0; i--) {
    const d = i * WORLD.trailStep;
    pushSample(t, x - dx * d, y - dy * d, length - d);
  }
}

export function pushSample(t: Trail, x: number, y: number, s: number): void {
  const cap = t.xs.length;
  t.head = (t.head + 1) % cap;
  t.xs[t.head] = x;
  t.ys[t.head] = y;
  t.ss[t.head] = s;
  if (t.count < cap) t.count++;
}

function at(t: Trail, logical: number): number {
  // logical 0 = oldest, count-1 = newest
  const cap = t.xs.length;
  return (t.head - (t.count - 1) + logical + cap * 2) % cap;
}

/**
 * Sample the trail at arc-length `s`, writing position and heading into `out`.
 * Clamps to the oldest sample when `s` is before the recorded history.
 */
export function sampleTrail(t: Trail, s: number, out: { x: number; y: number; angle: number }): void {
  const n = t.count;
  if (n === 0) return;
  if (n === 1) {
    const i = at(t, 0);
    out.x = t.xs[i];
    out.y = t.ys[i];
    return;
  }
  const oldest = at(t, 0);
  if (s <= t.ss[oldest]) {
    const next = at(t, 1);
    out.x = t.xs[oldest];
    out.y = t.ys[oldest];
    out.angle = Math.atan2(t.ys[next] - t.ys[oldest], t.xs[next] - t.xs[oldest]);
    return;
  }
  // binary search over logical indices for the segment containing s
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t.ss[at(t, mid)] <= s) lo = mid;
    else hi = mid;
  }
  const a = at(t, lo);
  const b = at(t, hi);
  const sa = t.ss[a];
  const sb = t.ss[b];
  const f = sb > sa ? Math.min(1, (s - sa) / (sb - sa)) : 0;
  out.x = t.xs[a] + (t.xs[b] - t.xs[a]) * f;
  out.y = t.ys[a] + (t.ys[b] - t.ys[a]) * f;
  out.angle = Math.atan2(t.ys[b] - t.ys[a], t.xs[b] - t.xs[a]);
}
