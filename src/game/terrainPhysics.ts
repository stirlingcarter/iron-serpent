import { TERRAIN, WORLD } from "./config";
import { gradientAt, heightAt } from "./terrain";
import type { Car, Train } from "./types";

const HALF = WORLD.carLength / 2;
/** per-car slope is clamped so a single car on a cliff face can't dominate the train */
const MAX_CAR_SLOPE = 1.5;
const MAX_GRADE = 1.2;
const MAX_FALL_SPEED = 1400;
const grad = { x: 0, y: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Falling cars have a negative vertical speed; grounded cars always have zero. */
export function isAirborne(car: Car | undefined): boolean {
  return !!car && car.vz < 0;
}

/** Multiplier on the throttle's target speed from the train's current grade. */
export function gradeFactor(train: Train): number {
  const g = Number.isFinite(train.grade) ? train.grade : 0;
  return clamp(1 - TERRAIN.gradeEffect * g, TERRAIN.minGradeFactor, TERRAIN.maxGradeFactor);
}

/**
 * Adjust the locomotive's next position for the terrain, writing it to `out`:
 * a steep cross-slope slides it sideways downhill, and an uphill cliff face
 * guides it along the cliff like the arena fence does. Downhill edges are not
 * blocked; the cars simply fall off them in `updateTerrain`.
 */
export function terrainStep(train: Train, nx: number, ny: number, dt: number, out: { x: number; y: number }): void {
  out.x = nx;
  out.y = ny;
  const loco = train.cars[0];
  const airborne = isAirborne(loco);
  const hx = Math.cos(train.angle);
  const hy = Math.sin(train.angle);

  if (!airborne) {
    gradientAt(train.x, train.y, grad);
    // component of the gradient across the direction of travel
    const lat = -grad.x * hy + grad.y * hx;
    const excess = Math.abs(lat) - TERRAIN.slideSlope;
    if (excess > 0 && Number.isFinite(excess)) {
      const push = -Math.sign(lat) * Math.min(excess, 1.5) * TERRAIN.slideRate * dt;
      out.x += -hy * push;
      out.y += hx * push;
    }
  }

  const step = Math.hypot(out.x - train.x, out.y - train.y);
  if (!(step > 1e-4)) return;
  const here = heightAt(train.x, train.y);
  const base = loco && Number.isFinite(loco.z) ? Math.max(loco.z, here) : here;
  const limit = TERRAIN.cliffSlope * step + 0.5;
  if (heightAt(out.x, out.y) - base <= limit) return;

  gradientAt(out.x, out.y, grad);
  const gl = Math.hypot(grad.x, grad.y);
  if (!(gl > 1e-6)) return;
  let tx = -grad.y / gl;
  let ty = grad.x / gl;
  if (tx * hx + ty * hy < 0) {
    tx = -tx;
    ty = -ty;
  }
  const gx = train.x + tx * step;
  const gy = train.y + ty * step;
  if (heightAt(gx, gy) - base <= limit) {
    out.x = gx;
    out.y = gy;
    train.angle = Math.atan2(ty, tx);
  }
  // Otherwise the train is wedged into a cliff corner: let it grind upward
  // rather than ever getting stuck.
}

/**
 * Settle every car onto the terrain and combine the per-car slopes into the
 * train's grade. Each car contributes the slope under its own bogies along its
 * own heading, so on a crest the cars still climbing hold the train back while
 * those already past it pull it forward. Cars that run off a cliff or ravine
 * edge leave the ground and fall until they land.
 */
export function updateTerrain(train: Train, dt: number): void {
  const cars = train.cars;
  const pitchK = Math.min(1, dt * 14);
  const speed = Number.isFinite(train.speed) ? Math.abs(train.speed) : 0;
  const tolerance = TERRAIN.fallSlope * speed * dt + TERRAIN.fallMinDrop;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    const ground = heightAt(c.x, c.y);
    if (!Number.isFinite(c.z) || !Number.isFinite(c.vz)) {
      c.z = ground;
      c.vz = 0;
    }
    let pitchTarget: number;
    if (c.vz < 0 || c.z - ground > tolerance) {
      c.vz = Math.max(-MAX_FALL_SPEED, Math.min(-1e-3, c.vz) - TERRAIN.gravity * dt);
      c.z += c.vz * dt;
      if (c.z <= ground) {
        if (i === 0) {
          const impact = -c.vz;
          train.landing = Math.max(train.landing || 0, impact);
          if (impact > TERRAIN.hardLanding) train.speed *= TERRAIN.hardLandingSpeed;
        }
        c.z = ground;
        c.vz = 0;
      }
      pitchTarget = clamp(Math.atan2(c.vz, speed + 1), -0.7, 0.7);
    } else {
      c.z = ground;
      c.vz = 0;
      const ca = Math.cos(c.angle);
      const sa = Math.sin(c.angle);
      const front = heightAt(c.x + ca * HALF, c.y + sa * HALF);
      const rear = heightAt(c.x - ca * HALF, c.y - sa * HALF);
      let slope = (front - rear) / (2 * HALF);
      if (!Number.isFinite(slope)) slope = 0;
      slope = clamp(slope, -MAX_CAR_SLOPE, MAX_CAR_SLOPE);
      pitchTarget = Math.atan(slope);
      const w = i === 0 ? TERRAIN.locoGradeWeight : 1;
      sum += slope * w;
      weight += w;
    }
    const pitch = Number.isFinite(c.pitch) ? c.pitch : 0;
    c.pitch = pitch + (pitchTarget - pitch) * pitchK;
  }
  const grade = weight > 0 ? sum / weight : 0;
  train.grade = Number.isFinite(grade) ? clamp(grade, -MAX_GRADE, MAX_GRADE) : 0;
}
