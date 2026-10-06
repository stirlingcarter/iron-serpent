import { TERRAIN, WORLD } from "./config";
import { heightAt } from "./terrain";
import type { Train } from "./types";

const HALF = WORLD.carLength / 2;
/** per-car slope is clamped so a single car on a cliff face can't dominate the train */
const MAX_CAR_SLOPE = 1.5;
const MAX_GRADE = 1.2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Multiplier on the throttle's target speed from the train's current grade. */
export function gradeFactor(train: Train): number {
  const g = Number.isFinite(train.grade) ? train.grade : 0;
  return clamp(1 - TERRAIN.gradeEffect * g, TERRAIN.minGradeFactor, TERRAIN.maxGradeFactor);
}

/**
 * Settle every car onto the terrain and combine the per-car slopes into the
 * train's grade. Each car contributes the slope under its own bogies along its
 * own heading, so on a crest the cars still climbing hold the train back while
 * those already past it pull it forward.
 */
export function updateTerrain(train: Train, dt: number): void {
  const cars = train.cars;
  const pitchK = Math.min(1, dt * 14);
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    const ca = Math.cos(c.angle);
    const sa = Math.sin(c.angle);
    const front = heightAt(c.x + ca * HALF, c.y + sa * HALF);
    const rear = heightAt(c.x - ca * HALF, c.y - sa * HALF);
    let slope = (front - rear) / (2 * HALF);
    if (!Number.isFinite(slope)) slope = 0;
    slope = clamp(slope, -MAX_CAR_SLOPE, MAX_CAR_SLOPE);
    c.z = heightAt(c.x, c.y);
    c.vz = 0;
    const pitch = Number.isFinite(c.pitch) ? c.pitch : 0;
    c.pitch = pitch + (Math.atan(slope) - pitch) * pitchK;
    const w = i === 0 ? TERRAIN.locoGradeWeight : 1;
    sum += slope * w;
    weight += w;
  }
  const grade = weight > 0 ? sum / weight : 0;
  train.grade = Number.isFinite(grade) ? clamp(grade, -MAX_GRADE, MAX_GRADE) : 0;
}
