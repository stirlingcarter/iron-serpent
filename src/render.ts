import { CAR_DEFS, COMBAT, WORLD } from "./game/config";
import type { Game } from "./game/game";
import type { Car, Cow, Particle, Train } from "./game/types";

const CAR_L = WORLD.carLength;
const CAR_W = WORLD.carWidth;
const CLOUDS: ReadonlyArray<readonly [number, number, number]> = [
  [-180, 240, 1],
  [-130, 980, 0.75],
  [-190, 2060, 1.2],
  [-120, 3230, 0.85],
  [WORLD.width + 150, 520, 0.9],
  [WORLD.width + 180, 1520, 1.15],
  [WORLD.width + 120, 2740, 0.72],
  [WORLD.width + 170, 3460, 1],
  [420, -150, 0.9],
  [1500, -170, 1.1],
  [2800, -130, 0.8],
  [700, WORLD.height + 150, 1.15],
  [2050, WORLD.height + 130, 0.75],
  [3200, WORLD.height + 170, 1],
];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 1;
  private height = 1;
  camX = WORLD.width / 2;
  camY = WORLD.height / 2;
  zoom = 1;
  private frame = 0;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D is not supported in this browser");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    // keep roughly the same field of view on phones and desktops
    this.zoom = Math.max(0.62, Math.min(1.15, Math.min(this.width, this.height) / 760));
  }

  snapCamera(game: Game): void {
    this.camX = game.snap.player.x;
    this.camY = game.snap.player.y;
  }

  /**
   * `alpha` is the fraction of a physics step elapsed since the last update;
   * trains are drawn between their previous and current step poses.
   */
  draw(game: Game, dt: number, alpha = 1): void {
    const ctx = this.ctx;
    const snap = game.snap;
    const player = snap.player;
    this.frame++;
    this.alpha = snap.phase === "playing" ? Math.max(0, Math.min(1, alpha)) : 1;

    // camera: lead slightly in the direction of travel
    const loco = player.cars[0];
    const px = loco ? this.ix(loco) : player.x;
    const py = loco ? this.iy(loco) : player.y;
    const pa = loco ? this.ia(loco) : player.angle;
    const lead = Math.min(120, player.speed * 0.45);
    const tx = px + Math.cos(pa) * lead;
    const ty = py + Math.sin(pa) * lead;
    const k = 1 - Math.exp(-dt * 4.5);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    let sx = 0;
    let sy = 0;
    if (game.shake > 0) {
      sx = (Math.random() - 0.5) * game.shake;
      sy = (Math.random() - 0.5) * game.shake;
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // The area beyond the fence reads as a calm, distant blue horizon.
    ctx.fillStyle = "#80b8cf";
    ctx.fillRect(0, 0, this.width, this.height);

    const z = this.zoom;
    ctx.translate(this.width / 2 + sx, this.height / 2 + sy);
    ctx.scale(z, z);
    ctx.translate(-this.camX, -this.camY);

    const halfW = this.width / 2 / z;
    const halfH = this.height / 2 / z;
    const left = this.camX - halfW;
    const top = this.camY - halfH;
    const right = this.camX + halfW;
    const bottom = this.camY + halfH;

    this.drawLandscape(left, top, right, bottom);
    for (const cow of game.cows) this.drawCow(cow, left, top, right, bottom);
    this.drawMines(game, left, top, right, bottom);
    this.drawPickups(game);
    for (const e of game.enemies) this.drawTrain(e, left, top, right, bottom);
    this.drawTrain(player, left, top, right, bottom);
    this.drawGrapples(game);
    this.drawBullets(game, left, top, right, bottom);
    this.drawParticles(game.particles, left, top, right, bottom);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (snap.phase === "playing" || snap.phase === "paused" || snap.phase === "shop") {
      this.drawOffscreenMarkers(game);
    }
  }

  private alpha = 1;

  private ix(c: Car): number {
    return c.prevX + (c.x - c.prevX) * this.alpha;
  }

  private iy(c: Car): number {
    return c.prevY + (c.y - c.prevY) * this.alpha;
  }

  private ia(c: Car): number {
    let d = c.angle - c.prevAngle;
    if (d > Math.PI) d -= Math.PI * 2;
    else if (d < -Math.PI) d += Math.PI * 2;
    return c.prevAngle + d * this.alpha;
  }

  // ---------------------------------------------------------------- pieces

  private drawLandscape(left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    this.drawClouds(left, top, right, bottom);

    ctx.fillStyle = "#5f9f58";
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    // Deterministic, sparse blades: enough texture to read as grass without
    // introducing visual noise or frame-to-frame shimmer.
    const cell = 74;
    const x0 = Math.max(0, Math.floor(left / cell) * cell);
    const y0 = Math.max(0, Math.floor(top / cell) * cell);
    const x1 = Math.min(WORLD.width, right);
    const y1 = Math.min(WORLD.height, bottom);
    ctx.strokeStyle = "rgba(35, 99, 48, 0.20)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let y = y0; y <= y1; y += cell) {
      for (let x = x0; x <= x1; x += cell) {
        const seed = ((x / cell) * 37 + (y / cell) * 61) % 17;
        const px = x + 12 + seed * 2.1;
        const py = y + 17 + ((seed * 11) % 31);
        ctx.moveTo(px - 4, py + 3);
        ctx.quadraticCurveTo(px - 2, py - 4, px, py - 6);
        ctx.moveTo(px, py + 3);
        ctx.quadraticCurveTo(px + 2, py - 3, px + 5, py - 5);
      }
    }
    ctx.stroke();

    // A solid fence exactly follows the collision boundary. The locomotive
    // centre remains one car radius inside it, so its body meets the wall.
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#e5d4a4";
    ctx.strokeRect(0, 0, WORLD.width, WORLD.height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#765f3d";
    ctx.strokeRect(0, 0, WORLD.width, WORLD.height);
  }

  private drawClouds(left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(238, 248, 249, 0.70)";
    for (const [x, y, scale] of CLOUDS) {
      if (x < left - 100 || x > right + 100 || y < top - 60 || y > bottom + 60) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.beginPath();
      ctx.ellipse(-22, 4, 27, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(0, -3, 25, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(25, 5, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawCow(cow: Cow, left: number, top: number, right: number, bottom: number): void {
    if (cow.x < left - 20 || cow.x > right + 20 || cow.y < top - 20 || cow.y > bottom + 20) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cow.x, cow.y);
    ctx.rotate(cow.angle);
    ctx.fillStyle = "#f1ead8";
    ctx.strokeStyle = "#4a4034";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#4a4034";
    ctx.beginPath();
    ctx.arc(-3, -2, 2.2, 0, Math.PI * 2);
    ctx.arc(4, 2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8d8bd";
    ctx.fillRect(8, -4, 5, 8);
    ctx.restore();
  }

  private drawMines(game: Game, left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    const blink = (this.frame >> 4) & 1;
    for (const m of game.mines) {
      if (m.x < left - 20 || m.x > right + 20 || m.y < top - 20 || m.y > bottom + 20) continue;
      ctx.fillStyle = m.team === "player" ? "#3a2a16" : "#3a1616";
      ctx.beginPath();
      ctx.arc(m.x, m.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = m.team === "player" ? "#ffb067" : "#ff5c5c";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (m.arm <= 0 && blink) {
        ctx.fillStyle = m.team === "player" ? "#ffb067" : "#ff5c5c";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawPickups(game: Game): void {
    const ctx = this.ctx;
    for (const k of game.pickups) {
      const def = CAR_DEFS[k.kind];
      const bob = Math.sin(k.bob * 4) * 3;
      const fade = k.life < 5 ? 0.4 + 0.6 * Math.abs(Math.sin(k.life * 6)) : 1;
      ctx.globalAlpha = fade;
      ctx.save();
      ctx.translate(k.x, k.y + bob);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#1b2231";
      ctx.strokeStyle = def.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-11, -11, 22, 22, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = def.accent;
      ctx.font = "bold 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.glyph, k.x, k.y + bob + 1);
      ctx.globalAlpha = 1;
      // beacon ring
      ctx.strokeStyle = def.accent;
      ctx.globalAlpha = 0.25 + 0.2 * Math.sin(k.bob * 3);
      ctx.beginPath();
      ctx.arc(k.x, k.y, 22 + Math.sin(k.bob * 3) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawTrain(train: Train, left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    const cars = train.cars;
    const isPlayer = train.team === "player";
    const margin = 40;

    // couplings
    ctx.strokeStyle = isPlayer ? "#6b7a93" : "#7a5b5b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 1; i < cars.length; i++) {
      const a = cars[i - 1];
      const b = cars[i];
      ctx.moveTo(this.ix(a), this.iy(a));
      ctx.lineTo(this.ix(b), this.iy(b));
    }
    ctx.stroke();

    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      const x = this.ix(c);
      const y = this.iy(c);
      if (x < left - margin || x > right + margin || y < top - margin || y > bottom + margin) continue;
      this.drawCar(c, x, y, this.ia(c), i === 0, isPlayer);
    }
  }

  private drawCar(c: Car, x: number, y: number, angle: number, isLoco: boolean, isPlayer: boolean): void {
    const ctx = this.ctx;
    const def = CAR_DEFS[c.kind];
    const len = isLoco ? CAR_L + 6 : CAR_L;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // wheels / bogies
    ctx.fillStyle = "#1a1f2b";
    ctx.fillRect(-len / 2 + 3, -CAR_W / 2 - 2, 7, CAR_W + 4);
    ctx.fillRect(len / 2 - 10, -CAR_W / 2 - 2, 7, CAR_W + 4);

    // body
    ctx.fillStyle = c.flash > 0 ? "#ffffff" : def.color;
    ctx.strokeStyle = isPlayer ? "#dfe7f5" : "#ff6b6b";
    ctx.lineWidth = isPlayer ? 1.5 : 2;
    ctx.beginPath();
    ctx.roundRect(-len / 2, -CAR_W / 2, len, CAR_W, 4);
    ctx.fill();
    ctx.stroke();

    if (isLoco) {
      // cab + chimney
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(-len / 2 + 2, -CAR_W / 2 + 2, 10, CAR_W - 4);
      ctx.fillStyle = "#0e1118";
      ctx.beginPath();
      ctx.arc(len / 2 - 9, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath();
      ctx.arc(len / 2 - 2, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      ctx.fillRect(-len / 2 + 4, -CAR_W / 2 + 3, len - 8, 3);
    }

    // glyph (upright regardless of heading)
    ctx.rotate(-angle);
    ctx.fillStyle = c.flash > 0 ? "#222" : "#ffffff";
    ctx.font = `bold ${isLoco ? 11 : 11}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isLoco ? "L" : def.glyph, 0, 0.5);

    // level pips
    if (c.level > 1) {
      ctx.fillStyle = "#ffe66d";
      const n = Math.min(5, c.level - 1);
      for (let i = 0; i < n; i++) ctx.fillRect(-n * 2 + i * 4, CAR_W / 2 + 4, 2.5, 2.5);
    }

    // HP bar when damaged
    if (c.hp < c.maxHp) {
      const w = 28;
      const f = Math.max(0, c.hp / c.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(-w / 2, -CAR_W / 2 - 9, w, 4);
      ctx.fillStyle = f > 0.5 ? "#4ade80" : f > 0.25 ? "#f5b942" : "#ff5c5c";
      ctx.fillRect(-w / 2, -CAR_W / 2 - 9, w * f, 4);
    }
    ctx.restore();
  }

  private drawGrapples(game: Game): void {
    const ctx = this.ctx;
    const all: Train[] = [game.snap.player, ...game.enemies];
    for (const t of all) {
      for (const c of t.cars) {
        if (c.kind !== "grapple" || !c.grappleTarget) continue;
        const g = c.grappleTarget;
        const f = 1 - c.grappleTimer / COMBAT.grappleDuration;
        const cx = this.ix(c);
        const cy = this.iy(c);
        const gx = this.ix(g);
        const gy = this.iy(g);
        const hx = cx + (gx - cx) * Math.min(1, f * 2.2);
        const hy = cy + (gy - cy) * Math.min(1, f * 2.2);
        ctx.strokeStyle = "#7ff5e0";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#7ff5e0";
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
        if (f * 2.2 >= 1) {
          ctx.strokeStyle = "rgba(127,245,224,0.8)";
          ctx.beginPath();
          ctx.arc(gx, gy, 18 + Math.sin(this.frame * 0.5) * 2, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
  }

  private drawBullets(game: Game, left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    // player bullets
    ctx.strokeStyle = "#9fdcff";
    ctx.beginPath();
    for (const b of game.bullets) {
      if (b.team !== "player") continue;
      if (b.x < left || b.x > right || b.y < top || b.y > bottom) continue;
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
    }
    ctx.stroke();
    ctx.strokeStyle = "#ff8a65";
    ctx.beginPath();
    for (const b of game.bullets) {
      if (b.team !== "enemy") continue;
      if (b.x < left || b.x > right || b.y < top || b.y > bottom) continue;
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  private drawParticles(list: Particle[], left: number, top: number, right: number, bottom: number): void {
    const ctx = this.ctx;
    for (const p of list) {
      if (p.x < left - 80 || p.x > right + 80 || p.y < top - 80 || p.y > bottom + 80) continue;
      const t = p.life / p.maxLife;
      switch (p.kind) {
        case "spark":
          ctx.globalAlpha = t;
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case "smoke":
          ctx.fillStyle = `${p.color}${(0.22 * t).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "ring": {
          const r = p.size * (1 - t * 0.6);
          ctx.globalAlpha = t;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 + 4 * t;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case "text":
          ctx.globalAlpha = Math.min(1, t * 1.5);
          ctx.fillStyle = p.color;
          ctx.font = `bold ${p.size}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(p.text ?? "", p.x, p.y);
          break;
      }
      ctx.globalAlpha = 1;
    }
  }

  private insetTop = 84;
  private insetBottom = 150;

  /** The DOM HUD and dock cover parts of the canvas; keep markers out from under them. */
  private measureInsets(): void {
    const hud = document.querySelector(".hud")?.getBoundingClientRect();
    const dock = document.querySelector(".dock")?.getBoundingClientRect();
    this.insetTop = hud && hud.height > 0 ? hud.bottom + 22 : 84;
    this.insetBottom = dock && dock.height > 0 ? this.height - dock.top + 22 : 150;
  }

  /** Arrow markers at the screen edge for enemy locomotives that are out of view. */
  private drawOffscreenMarkers(game: Game): void {
    const ctx = this.ctx;
    const z = this.zoom;
    if (this.frame % 30 === 0) this.measureInsets();
    const pad = 28;
    const topPad = this.insetTop;
    const bottomPad = this.insetBottom;
    for (const e of game.enemies) {
      const sx = (e.x - this.camX) * z + this.width / 2;
      const sy = (e.y - this.camY) * z + this.height / 2;
      const inside = sx > pad && sx < this.width - pad && sy > topPad && sy < this.height - bottomPad;
      if (inside) continue;
      const cx = Math.max(pad, Math.min(this.width - pad, sx));
      const cy = Math.max(topPad, Math.min(this.height - bottomPad, sy));
      const a = Math.atan2(sy - cy, sx - cx);
      const dist = Math.hypot(e.x - game.snap.player.x, e.y - game.snap.player.y);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.fillStyle = "rgba(255,92,92,0.9)";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-6, -8);
      ctx.lineTo(-2, 0);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(-a);
      ctx.fillStyle = "rgba(230,237,247,0.85)";
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${Math.round(dist / 10) * 10}`, 0, 18);
      ctx.restore();
    }
  }
}
