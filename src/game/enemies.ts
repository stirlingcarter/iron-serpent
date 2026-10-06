import { CAR_DEFS, MOVEMENT, WAVES, WORLD } from "./config";
import { createCar, createTrain } from "./train";
import type { AiState, Car, CarKind, Steer, Train } from "./types";

interface Weighted {
  kind: CarKind;
  weight: (wave: number) => number;
}

const ROSTER: Weighted[] = [
  { kind: "gun", weight: () => 6 },
  { kind: "engine", weight: (w) => 2 + Math.min(4, w * 0.3) },
  { kind: "health", weight: (w) => (w >= 3 ? 3 : 0) },
  { kind: "aoe", weight: (w) => (w >= 4 ? 2 + Math.min(5, w * 0.4) : 0) },
  { kind: "trap", weight: (w) => (w >= 5 ? 2 + Math.min(4, w * 0.3) : 0) },
  { kind: "gold", weight: (w) => (w >= 2 ? 2 : 0) },
  { kind: "grapple", weight: (w) => (w >= 10 ? 1 + Math.min(3, (w - 10) * 0.3) : 0) },
  { kind: "rocket", weight: (w) => (w >= 7 ? 1 + Math.min(3, (w - 7) * 0.3) : 0) },
  { kind: "sniper", weight: (w) => (w >= 12 ? 1 + Math.min(2, (w - 12) * 0.2) : 0) },
  { kind: "armor", weight: (w) => (w >= 8 ? 1 + Math.min(2, (w - 8) * 0.2) : 0) },
  { kind: "booster", weight: (w) => (w >= 9 ? 1 + Math.min(2, (w - 9) * 0.2) : 0) },
  { kind: "coupler", weight: (w) => (w >= 14 ? 1 : 0) },
];

function pickKind(wave: number): CarKind {
  let total = 0;
  for (const r of ROSTER) total += r.weight(wave);
  let roll = Math.random() * total;
  for (const r of ROSTER) {
    roll -= r.weight(wave);
    if (roll <= 0) return r.kind;
  }
  return "gun";
}

export function trainsForWave(wave: number): number {
  if (wave < 5) return 1;
  const r = Math.random();
  if (wave >= 10 && r < 0.12) return 3;
  if (r < 0.22) return 2;
  return 1;
}

export function buildEnemyCars(wave: number, budget: number): Car[] {
  const level = 1 + Math.floor(wave / 6);
  const hpScale = 1 + WAVES.hpScalePerWave * (wave - 1);
  const cars: Car[] = [createCar("engine", Math.max(1, level - 1), true, hpScale * 0.75)];
  let spent = 0;
  const maxLen = Math.min(WORLD.maxCars - 1, 2 + Math.floor(wave * 0.8));
  // guarantee at least one weapon so every enemy threatens the player
  const first = createCar("gun", level, false, hpScale);
  cars.push(first);
  spent += CAR_DEFS.gun.baseCost;
  while (spent < budget && cars.length - 1 < maxLen) {
    const kind = pickKind(wave);
    const cost = CAR_DEFS[kind].baseCost;
    if (spent + cost > budget) break;
    cars.push(createCar(kind, level, false, hpScale));
    spent += cost;
  }
  return cars;
}

export function spawnWave(wave: number, player: Train): Train[] {
  const count = trainsForWave(wave);
  const budget = (WAVES.budgetBase + WAVES.budgetPerWave * (wave - 1)) / Math.sqrt(count);
  const trains: Train[] = [];
  for (let i = 0; i < count; i++) {
    const cars = buildEnemyCars(wave, budget);
    const pos = pickSpawn(player, i, count);
    const angle = Math.atan2(player.y - pos.y, player.x - pos.x);
    const ai: AiState = {
      think: Math.random() * 0.3,
      orbitDir: Math.random() < 0.5 ? 1 : -1,
      orbitDist: 140 + Math.random() * 100,
      wander: 0,
    };
    const t = createTrain("enemy", pos.x, pos.y, angle, cars, ai);
    t.throttle = 1;
    trains.push(t);
  }
  return trains;
}

function pickSpawn(player: Train, index: number, count: number): { x: number; y: number } {
  const m = WAVES.spawnMargin;
  const cx = WORLD.width / 2;
  const cy = WORLD.height / 2;
  // bias spawn toward the arena side opposite the player, spread trains apart
  const away = Math.atan2(cy - player.y, cx - player.x);
  const spread = ((index - (count - 1) / 2) * Math.PI) / 3;
  const base = away + spread + (Math.random() - 0.5) * 0.6;
  for (let attempt = 0; attempt < 12; attempt++) {
    const dist = WAVES.spawnDistance + attempt * 120 + Math.random() * 200;
    const x = player.x + Math.cos(base) * dist;
    const y = player.y + Math.sin(base) * dist;
    if (x > m && x < WORLD.width - m && y > m && y < WORLD.height - m) return { x, y };
  }
  // fall back to a far corner
  const corners = [
    { x: m, y: m },
    { x: WORLD.width - m, y: m },
    { x: m, y: WORLD.height - m },
    { x: WORLD.width - m, y: WORLD.height - m },
  ];
  let best = corners[0];
  let bestD = -1;
  for (const c of corners) {
    const d = Math.hypot(c.x - player.x, c.y - player.y);
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Enemy trains use the same continuous steering and throttle as the player. */
export function updateAi(train: Train, player: Train, dt: number): void {
  const ai = train.ai;
  if (!ai) return;
  ai.think -= dt;
  if (ai.think > 0) return;
  ai.think = 0.12 + Math.random() * 0.08;
  ai.wander += (Math.random() - 0.5) * 0.6;
  ai.wander *= 0.9;

  const dx = player.x - train.x;
  const dy = player.y - train.y;
  const dist = Math.hypot(dx, dy);
  const toPlayer = Math.atan2(dy, dx);

  // Approach when far, orbit at preferred distance when close.
  let desired: number;
  if (dist > ai.orbitDist * 1.6) {
    desired = toPlayer + ai.wander * 0.3;
  } else {
    const tangent = toPlayer + (Math.PI / 2) * ai.orbitDir;
    const radial = dist < ai.orbitDist * 0.8 ? -0.9 : dist > ai.orbitDist * 1.05 ? 0.8 : 0;
    desired =
      Math.atan2(
        Math.sin(tangent) + Math.sin(toPlayer) * radial,
        Math.cos(tangent) + Math.cos(toPlayer) * radial,
      ) +
      ai.wander * 0.2;
  }

  // Wall avoidance: look ahead and steer toward the arena centre.
  const look = 200 + train.speed * 0.8;
  const ax = train.x + Math.cos(train.angle) * look;
  const ay = train.y + Math.sin(train.angle) * look;
  const m = 120;
  if (ax < m || ay < m || ax > WORLD.width - m || ay > WORLD.height - m) {
    desired = Math.atan2(WORLD.height / 2 - train.y, WORLD.width / 2 - train.x);
    if (Math.random() < 0.3) ai.orbitDir = ai.orbitDir === 1 ? -1 : 1;
  }

  const diff = angleDiff(desired, train.angle);
  // Proportional steering gives the AI the same smooth handling as the player.
  train.steer = Math.max(-1, Math.min(1, diff / 0.9)) as Steer;

  // throttle: sprint when far, cruise when orbiting, ease off when about to ram a wall
  if (dist > 700) train.throttle = 1;
  else if (dist < ai.orbitDist * 0.6 && Math.abs(diff) > 1.2) train.throttle = 0.55;
  else train.throttle = Math.random() < 0.15 ? 0.65 : 0.9;
  if (train.speed > MOVEMENT.baseSpeed * 1.4 && Math.abs(diff) > 2) train.throttle = 0.5;
}
