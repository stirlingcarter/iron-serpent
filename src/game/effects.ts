import type { Particle } from "./types";

const MAX_PARTICLES = 900;

export function addParticle(list: Particle[], p: Particle): void {
  if (list.length >= MAX_PARTICLES) {
    // drop the oldest to keep the frame budget stable
    list[0] = list[list.length - 1];
    list.pop();
  }
  list.push(p);
}

export function burst(list: Particle[], x: number, y: number, color: string, count: number, speed: number): void {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7);
    const life = 0.35 + Math.random() * 0.45;
    addParticle(list, {
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life,
      maxLife: life,
      size: 2 + Math.random() * 3,
      color,
      kind: "spark",
    });
  }
}

export function smokePuff(list: Particle[], x: number, y: number, vx: number, vy: number): void {
  const life = 0.9 + Math.random() * 0.5;
  addParticle(list, {
    x,
    y,
    vx: vx * 0.15 + (Math.random() - 0.5) * 12,
    vy: vy * 0.15 + (Math.random() - 0.5) * 12,
    life,
    maxLife: life,
    size: 5 + Math.random() * 4,
    color: "rgba(200,205,215,",
    kind: "smoke",
  });
}

export function ring(list: Particle[], x: number, y: number, radius: number, color: string): void {
  addParticle(list, {
    x,
    y,
    vx: 0,
    vy: 0,
    life: 0.4,
    maxLife: 0.4,
    size: radius,
    color,
    kind: "ring",
  });
}

export function floatText(list: Particle[], x: number, y: number, text: string, color: string): void {
  addParticle(list, {
    x,
    y,
    vx: (Math.random() - 0.5) * 10,
    vy: -42,
    life: 0.9,
    maxLife: 0.9,
    size: 13,
    color,
    kind: "text",
    text,
  });
}

export function updateParticles(list: Particle[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.life -= dt;
    if (p.life <= 0) {
      list[i] = list[list.length - 1];
      list.pop();
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "spark") {
      p.vx *= 1 - 3 * dt;
      p.vy *= 1 - 3 * dt;
    } else if (p.kind === "smoke") {
      p.size += 9 * dt;
    }
  }
}
