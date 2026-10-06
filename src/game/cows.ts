import { WORLD } from "./config";
import type { Cow, Train } from "./types";

const COUNT = 34;
const MARGIN = 55;
const FLEE_RADIUS = 230;

export function createCows(): Cow[] {
  return Array.from({ length: COUNT }, () => ({
    x: MARGIN + Math.random() * (WORLD.width - MARGIN * 2),
    y: MARGIN + Math.random() * (WORLD.height - MARGIN * 2),
    angle: Math.random() * Math.PI * 2,
    speed: 0,
    think: Math.random() * 2,
    wander: (Math.random() - 0.5) * 0.8,
  }));
}

export function updateCows(cows: Cow[], trains: Train[], dt: number): void {
  for (const cow of cows) {
    let nearest: Train | null = null;
    let nearestD2 = FLEE_RADIUS * FLEE_RADIUS;
    for (const train of trains) {
      if (!train.alive) continue;
      const dx = cow.x - train.x;
      const dy = cow.y - train.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < nearestD2) {
        nearest = train;
        nearestD2 = d2;
      }
    }

    if (nearest) {
      const away = Math.atan2(cow.y - nearest.y, cow.x - nearest.x);
      const blend = Math.min(1, dt * 8);
      cow.angle = blendAngle(cow.angle, away, blend);
      cow.speed += (115 - cow.speed) * Math.min(1, dt * 5);
    } else {
      cow.think -= dt;
      if (cow.think <= 0) {
        cow.think = 1.5 + Math.random() * 3;
        cow.wander = (Math.random() - 0.5) * 1.2;
      }
      cow.angle += cow.wander * dt;
      cow.speed += (12 - cow.speed) * Math.min(1, dt * 2);
    }

    const look = 90;
    const ax = cow.x + Math.cos(cow.angle) * look;
    const ay = cow.y + Math.sin(cow.angle) * look;
    if (ax < MARGIN || ay < MARGIN || ax > WORLD.width - MARGIN || ay > WORLD.height - MARGIN) {
      cow.angle = Math.atan2(WORLD.height / 2 - cow.y, WORLD.width / 2 - cow.x);
    }
    cow.x = Math.max(MARGIN, Math.min(WORLD.width - MARGIN, cow.x + Math.cos(cow.angle) * cow.speed * dt));
    cow.y = Math.max(MARGIN, Math.min(WORLD.height - MARGIN, cow.y + Math.sin(cow.angle) * cow.speed * dt));
  }
}

function blendAngle(from: number, to: number, amount: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * amount;
}
