import { CAR_DEFS, COMBAT, MOVEMENT, WORLD } from "./config";
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
    x: 0,
    y: 0,
    angle: 0,
    cooldown: Math.random() * 0.5,
    flash: 0,
    grappleTarget: null,
    grappleTimer: 0,
  };
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
  };
  seedTrail(train.trail, x, y, angle, trailLength);
  train.odometer = trailLength;
  layoutCars(train);
  return train;
}

export function speedBonus(train: Train): number {
  let bonus = 0;
  for (let i = 1; i < train.cars.length; i++) {
    const c = train.cars[i];
    if (c.kind === "engine") {
      const s = CAR_DEFS.engine.stats;
      bonus += (s.speedBonus ?? 0) + (s.speedBonusPerLevel ?? 0) * (c.level - 1);
    }
  }
  // the locomotive's own level adds a little thrust too
  bonus += (train.cars[0]?.level ?? 1) * 4 - 4;
  return bonus;
}

export function targetSpeed(train: Train): number {
  const t: Throttle = Math.max(0, Math.min(1, train.throttle));
  const max = (MOVEMENT.baseSpeed + speedBonus(train)) * MOVEMENT.fastMultiplier;
  return max * t;
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

export function layoutCars(train: Train): void {
  const cars = train.cars;
  if (cars.length === 0) return;
  cars[0].x = train.x;
  cars[0].y = train.y;
  cars[0].angle = train.angle;
  const trail = train.trail;
  for (let i = 1; i < cars.length; i++) {
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

/** Current angular velocity (rad/s). Turning radius grows a little with speed so fast trains feel heavier. */
export function turnRateOf(train: Train): number {
  if (train.speed <= 0.01) return 0;
  const speedFactor = 1 / (0.8 + 0.2 * (train.speed / MOVEMENT.baseSpeed));
  return train.steer * MOVEMENT.turnRate * speedFactor;
}

export function moveTrain(train: Train, dt: number): void {
  const target = targetSpeed(train);
  if (train.speed < target) train.speed = Math.min(target, train.speed + MOVEMENT.accel * dt);
  else if (train.speed > target) train.speed = Math.max(target, train.speed - MOVEMENT.brake * dt);

  if (train.speed > 0.01) {
    train.angle += turnRateOf(train) * dt;
    if (train.angle > Math.PI) train.angle -= Math.PI * 2;
    else if (train.angle < -Math.PI) train.angle += Math.PI * 2;

    let nx = train.x + Math.cos(train.angle) * train.speed * dt;
    let ny = train.y + Math.sin(train.angle) * train.speed * dt;
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
  layoutCars(train);
}

export function clampSteer(s: number): Steer {
  return Math.max(-1, Math.min(1, s)) as Steer;
}
