import { BUFFS, CAR_DEFS, COMBAT, MOVEMENT, TERRAIN, WORLD } from "./config";
import { heightAt } from "./terrain";
import { gradeFactor, isAirborne, terrainStep, updateTerrain } from "./terrainPhysics";
import { createTrail, pushSample, sampleTrail, seedTrail } from "./trail";
import type { AiState, Car, CarKind, Steer, Team, Throttle, Train } from "./types";

let nextId = 1;

export function carHpForLevel(kind: CarKind, level: number, isLoco: boolean): number {
  if (isLoco) return COMBAT.locoHp + COMBAT.locoHpPerLevel * (level - 1);
  const d = CAR_DEFS[kind];
  return d.baseHp + d.hpPerLevel * (level - 1);
}

export function createCar(kind: CarKind, level = 1, isLoco = false, hpScale = 1): Car {
  const maxHp = Math.round(carHpForLevel(kind, level, isLoco) * hpScale);
  return {
    id: nextId++,
    kind,
    level,
    hp: maxHp,
    maxHp,
    baseMaxHp: maxHp,
    hpMult: 1,
    x: 0,
    y: 0,
    angle: 0,
    prevX: 0,
    prevY: 0,
    prevAngle: 0,
    cooldown: Math.random() * 0.5,
    flash: 0,
    grappleTarget: null,
    grappleTimer: 0,
    z: NaN,
    vz: 0,
    pitch: 0,
  };
}

/** Couple a car onto the tail. Engines join in the same place as any other car. */
export function coupleCar(train: Train, car: Car): void {
  train.cars.push(car);
}

export function createTrain(
  team: Team,
  x: number,
  y: number,
  angle: number,
  cars: Car[],
  ai: AiState | null,
  trailLength = (cars.length + 2) * WORLD.carSpacing,
): Train {
  const train: Train = {
    id: nextId++,
    team,
    cars,
    x,
    y,
    angle,
    speed: 0,
    steer: 0,
    throttle: team === "enemy" ? 1 : 0,
    alive: true,
    odometer: 0,
    trail: createTrail(),
    ai,
    smoke: 0,
    grade: 0,
    landing: 0,
    buffs: { hpMult: 1, armor: 0, heal: 0, guardRate: 0, guardTime: Infinity },
    guardCharge: 0,
  };
  seedTrail(train.trail, x, y, angle, trailLength);
  train.odometer = trailLength;
  layoutCars(train);
  updateBuffs(train);
  return train;
}

/** Diminishing-returns stacking: ~sum for small sums, approaches `cap`. */
export function stackCapped(sum: number, cap: number): number {
  if (!(sum > 0) || !(cap > 0)) return 0;
  return cap * (1 - Math.exp(-sum / cap));
}

function levelStat(base: number | undefined, perLevel: number | undefined, level: number): number {
  return (base ?? 0) + (perLevel ?? 0) * (level - 1);
}

/** Regrow the train's single cattle-guard charge; it is lost when no guard cars remain. */
export function updateGuard(train: Train, dt: number): void {
  const b = train.buffs;
  if (!(b.guardRate > 0)) {
    train.guardCharge = 0;
    return;
  }
  if (train.guardCharge < 1) train.guardCharge = Math.min(1, train.guardCharge + dt / b.guardTime);
}

/** Rescale a car's max HP to `mult`, keeping its HP fraction. */
export function applyHpMult(car: Car, mult: number): void {
  const max = Math.max(1, Math.round(car.baseMaxHp * mult));
  if (max !== car.maxHp) {
    if (car.maxHp > 0 && Number.isFinite(car.hp)) car.hp = (car.hp * max) / car.maxHp;
    car.maxHp = max;
  }
  car.hpMult = mult;
}

/**
 * Recompute the train's aura totals in a single pass (O(cars), never per car
 * pair), and bring any car whose max HP is stale up to the current multiplier.
 */
export function updateBuffs(train: Train): void {
  const cars = train.cars;
  let hp = 0;
  let armor = 0;
  let heal = 0;
  let guard = 0;
  for (let i = 1; i < cars.length; i++) {
    const c = cars[i];
    switch (c.kind) {
      case "booster": {
        const s = CAR_DEFS.booster.stats;
        hp += levelStat(s.hpBoost, s.hpBoostPerLevel, c.level);
        break;
      }
      case "armor": {
        const s = CAR_DEFS.armor.stats;
        armor += levelStat(s.armor, s.armorPerLevel, c.level);
        break;
      }
      case "health": {
        const s = CAR_DEFS.health.stats;
        heal += levelStat(s.healPerSec, s.healPerLevel, c.level);
        break;
      }
      case "guard": {
        const s = CAR_DEFS.guard.stats;
        guard += levelStat(s.guardRate, s.guardRatePerLevel, c.level);
        break;
      }
      default:
        break;
    }
  }
  const b = train.buffs;
  b.hpMult = 1 + stackCapped(hp, BUFFS.hpBoostCap);
  b.armor = stackCapped(armor, BUFFS.armorCap);
  b.heal = heal;
  b.guardRate = guard;
  b.guardTime =
    guard > 0
      ? Math.max(BUFFS.guardMinRecharge, BUFFS.guardRecharge / Math.pow(guard, BUFFS.guardStackExponent))
      : Infinity;
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].hpMult !== b.hpMult) applyHpMult(cars[i], b.hpMult);
  }
}

export function speedBonus(train: Train): number {
  let bonus = 0;
  let drag = 0;
  for (let i = 1; i < train.cars.length; i++) {
    const c = train.cars[i];
    if (c.kind === "engine") {
      const s = CAR_DEFS.engine.stats;
      bonus += (s.speedBonus ?? 0) + (s.speedBonusPerLevel ?? 0) * (c.level - 1);
    } else {
      // cargo weight: every non-engine car slows the train a little
      drag += MOVEMENT.carDrag;
    }
  }
  // the locomotive's own level adds a little thrust too (and never counts as drag)
  bonus += (train.cars[0]?.level ?? 1) * 4 - 4;
  return bonus - drag;
}

export function targetSpeed(train: Train): number {
  const t: Throttle = Math.max(0, Math.min(1, train.throttle));
  const powered = Math.max(MOVEMENT.minPoweredSpeed, MOVEMENT.baseSpeed + speedBonus(train));
  return powered * MOVEMENT.fastMultiplier * t;
}

export function goldBonus(train: Train): number {
  let bonus = 0;
  for (const c of train.cars) {
    if (c.kind === "gold") {
      const s = CAR_DEFS.gold.stats;
      bonus += (s.goldBonus ?? 0) + (s.goldBonusPerLevel ?? 0) * (c.level - 1);
    }
  }
  return bonus;
}

const sampleOut = { x: 0, y: 0, angle: 0 };
const frontOut = { x: 0, y: 0, angle: 0 };
const rearOut = { x: 0, y: 0, angle: 0 };
const BOGIE_HALF = WORLD.carLength / 2;

/** Record every car's current pose as the start of the next physics step. */
export function storePrevPose(train: Train): void {
  for (const c of train.cars) {
    c.prevX = c.x;
    c.prevY = c.y;
    c.prevAngle = c.angle;
  }
}

/** Re-place cars after a structural change (buy, sell, reorder, capture) without interpolating from old slots. */
export function layoutCars(train: Train): void {
  placeCars(train);
  storePrevPose(train);
}

/**
 * After cars[from - 1] and its old successor were joined (a car between them
 * was removed), snap every car from `from` back into its trail slot. The jump
 * is not interpolated, and grounded cars are settled onto the terrain at their
 * new spot so the shift can't read as a ledge and launch them.
 */
export function closeGap(train: Train, from: number): void {
  const cars = train.cars;
  if (from >= cars.length) return;
  placeCars(train, from);
  for (let i = Math.max(0, from); i < cars.length; i++) {
    const c = cars[i];
    c.prevX = c.x;
    c.prevY = c.y;
    c.prevAngle = c.angle;
    if (!(c.vz < 0)) {
      const ground = heightAt(c.x, c.y);
      c.z = Number.isFinite(ground) ? ground : NaN;
      c.vz = 0;
    }
  }
}

function placeCars(train: Train, from = 0): void {
  const cars = train.cars;
  if (cars.length === 0) return;
  cars[0].x = train.x;
  cars[0].y = train.y;
  cars[0].angle = train.angle;
  const trail = train.trail;
  for (let i = Math.max(1, from); i < cars.length; i++) {
    const car = cars[i];
    const s = train.odometer - i * WORLD.carSpacing;
    sampleTrail(trail, s, sampleOut);
    car.x = sampleOut.x;
    car.y = sampleOut.y;
    // Heading follows the bogie chord; a single trail segment's direction
    // changes in discrete steps on curves.
    sampleTrail(trail, s + BOGIE_HALF, frontOut);
    sampleTrail(trail, s - BOGIE_HALF, rearOut);
    const hx = frontOut.x - rearOut.x;
    const hy = frontOut.y - rearOut.y;
    car.angle = hx * hx + hy * hy > 1e-6 ? Math.atan2(hy, hx) : sampleOut.angle;
  }
}

/**
 * Current angular velocity (rad/s). Up to stock full speed this is the classic
 * curve; above it the rate scales with speed so the turning radius stays near
 * MOVEMENT.turnRadius, widening slightly as engines push speed higher.
 */
export function turnRateOf(train: Train): number {
  const v = train.speed;
  if (v <= 0.01) return 0;
  const classic = MOVEMENT.turnRate / (0.8 + 0.2 * (v / MOVEMENT.baseSpeed));
  const extra = Math.max(0, v / MOVEMENT.turnRadiusRefSpeed - 1);
  const radius = MOVEMENT.turnRadius * (1 + MOVEMENT.turnRadiusWiden * extra);
  const rate = Math.min(MOVEMENT.maxTurnRate, Math.max(classic, v / radius));
  return train.steer * rate;
}

const terrainOut = { x: 0, y: 0 };

export function moveTrain(train: Train, dt: number): void {
  storePrevPose(train);
  const base = targetSpeed(train);
  // a locomotive in mid-air has no traction or steering
  const airborne = isAirborne(train.cars[0]);
  const target = airborne ? train.speed : base * gradeFactor(train);
  if (train.speed < target) train.speed = Math.min(target, train.speed + MOVEMENT.accel * dt);
  else if (train.speed > target) {
    // Full brakes only when stopping; terrain and throttle changes coast down gently.
    const decel = train.throttle < 0.05 ? MOVEMENT.brake : train.speed > base ? TERRAIN.coastDecel : TERRAIN.gradeDecel;
    train.speed = Math.max(target, train.speed - decel * dt);
  }
  if (!Number.isFinite(train.speed)) train.speed = 0;

  if (train.speed > 0.01) {
    if (!airborne) train.angle += turnRateOf(train) * dt;
    if (train.angle > Math.PI) train.angle -= Math.PI * 2;
    else if (train.angle < -Math.PI) train.angle += Math.PI * 2;

    let nx = train.x + Math.cos(train.angle) * train.speed * dt;
    let ny = train.y + Math.sin(train.angle) * train.speed * dt;
    terrainStep(train, nx, ny, dt, terrainOut);
    nx = terrainOut.x;
    ny = terrainOut.y;
    const m = WORLD.carRadius;
    const hitX = nx < m || nx > WORLD.width - m;
    const hitY = ny < m || ny > WORLD.height - m;
    if (hitX || hitY) {
      // Walls guide trains instead of damaging or stopping them: discard the
      // outward component and align the locomotive with the wall tangent.
      if (hitX && !hitY) {
        nx = Math.max(m, Math.min(WORLD.width - m, nx));
        train.angle = Math.sin(train.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2;
        ny = train.y + Math.sin(train.angle) * train.speed * dt;
      } else if (hitY && !hitX) {
        ny = Math.max(m, Math.min(WORLD.height - m, ny));
        train.angle = Math.cos(train.angle) >= 0 ? 0 : Math.PI;
        nx = train.x + Math.cos(train.angle) * train.speed * dt;
      } else {
        // At a corner, follow the wall requiring the smaller correction.
        const xCorrection = nx < m ? m - nx : nx - (WORLD.width - m);
        const yCorrection = ny < m ? m - ny : ny - (WORLD.height - m);
        if (xCorrection <= yCorrection) {
          nx = Math.max(m, Math.min(WORLD.width - m, nx));
          train.angle = Math.sin(train.angle) >= 0 ? Math.PI / 2 : -Math.PI / 2;
          ny = train.y + Math.sin(train.angle) * train.speed * dt;
        } else {
          ny = Math.max(m, Math.min(WORLD.height - m, ny));
          train.angle = Math.cos(train.angle) >= 0 ? 0 : Math.PI;
          nx = train.x + Math.cos(train.angle) * train.speed * dt;
        }
      }
    }
    nx = Math.max(m, Math.min(WORLD.width - m, nx));
    ny = Math.max(m, Math.min(WORLD.height - m, ny));
    const dx = nx - train.x;
    const dy = ny - train.y;
    const moved = Math.hypot(dx, dy);
    if (moved > 0) {
      train.x = nx;
      train.y = ny;
      train.odometer += moved;
      const t = train.trail;
      const last = t.head >= 0 ? t.ss[t.head] : -Infinity;
      if (train.odometer - last >= WORLD.trailStep) pushSample(t, nx, ny, train.odometer);
    }
  }
  placeCars(train);
  updateTerrain(train, dt);
}

export function clampSteer(s: number): Steer {
  return Math.max(-1, Math.min(1, s)) as Steer;
}
