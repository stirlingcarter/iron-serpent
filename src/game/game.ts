import { CAR_DEFS, CAR_KINDS, COMBAT, ECONOMY, WAVES, WORLD, cooldownForLevel, enemyDamageScale } from "./config";
import { createCows, updateCows } from "./cows";
import { burst, floatText, ring, smokePuff, updateParticles } from "./effects";
import { spawnWave, updateAi } from "./enemies";
import { carHpForLevel, clampSteer, createCar, createTrain, goldBonus, layoutCars, moveTrain, turnRateOf } from "./train";
import type {
  BestRun,
  Bullet,
  Car,
  CarKind,
  Cow,
  GameApi,
  GameSnapshot,
  Mine,
  Particle,
  Pickup,
  Phase,
  Steer,
  Team,
  Throttle,
  Train,
} from "./types";

const BEST_KEY = "railgun.best.v1";
const RUN_KEY = "railgun.run.v1";
const MAX_MINES = 220;

const aim = { x: 0, y: 0 };

/** Where will this car be in `t` seconds, assuming its train keeps its current steer and speed? */
function predictCar(car: Car, train: Train, t: number, out: { x: number; y: number }): void {
  const v = train.speed;
  const omega = turnRateOf(train);
  if (Math.abs(omega) < 0.05) {
    out.x = car.x + Math.cos(car.angle) * v * t;
    out.y = car.y + Math.sin(car.angle) * v * t;
    return;
  }
  const r = v / omega;
  const a0 = car.angle;
  const a1 = a0 + omega * t;
  out.x = car.x + r * (Math.sin(a1) - Math.sin(a0));
  out.y = car.y - r * (Math.cos(a1) - Math.cos(a0));
}

interface Target {
  car: Car;
  train: Train;
  dist: number;
}

interface SavedRun {
  version: 1;
  savedAt: number;
  wave: number;
  gold: number;
  time: number;
  stats: GameSnapshot["stats"];
  player: {
    x: number;
    y: number;
    angle: number;
    speed: number;
    throttle: number;
    cars: Array<Pick<Car, "kind" | "level" | "hp" | "maxHp" | "cooldown">>;
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function restoredStats(value: unknown): GameSnapshot["stats"] {
  const source = value && typeof value === "object" ? (value as Partial<GameSnapshot["stats"]>) : {};
  const count = (entry: unknown) => Math.max(0, Math.floor(finite(entry, 0)));
  return {
    kills: count(source.kills),
    trainsDestroyed: count(source.trainsDestroyed),
    goldEarned: count(source.goldEarned),
    carsLost: count(source.carsLost),
    carsCaptured: count(source.carsCaptured),
  };
}

function loadBest(): BestRun {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw) {
      const b = JSON.parse(raw) as Partial<BestRun>;
      if (Number.isFinite(b.wave)) {
        return {
          wave: Math.max(0, Math.floor(finite(b.wave, 0))),
          time: Math.max(0, finite(b.time, 0)),
          gold: Math.max(0, finite(b.gold, 0)),
        };
      }
    }
  } catch {
    /* storage unavailable: run without persistence */
  }
  return { wave: 0, time: 0, gold: 0 };
}

function saveBest(b: BestRun): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

export class Game implements GameApi {
  snap: GameSnapshot;
  readonly maxCars = WORLD.maxCars;

  enemies: Train[] = [];
  bullets: Bullet[] = [];
  mines: Mine[] = [];
  pickups: Pickup[] = [];
  particles: Particle[] = [];
  cows: Cow[] = createCows();
  /** camera shake magnitude in px */
  shake = 0;

  private waveTimer = 0;
  private spawnPending = false;
  /** A restored run replays its interrupted wave without changing its number. */
  private restoredWavePending = false;
  private phaseBeforeShop: Phase = "playing";
  private dirty = false;
  private saveTimer = 0;
  private listeners = new Set<() => void>();
  private readonly target: Target = { car: null as unknown as Car, train: null as unknown as Train, dist: 0 };

  constructor() {
    this.snap = this.freshSnapshot();
    this.restoreProgress();
  }

  // ---------------------------------------------------------------- lifecycle

  private freshSnapshot(): GameSnapshot {
    const loco = createCar("engine", 1, true);
    const player = createTrain(
      "player",
      WORLD.width / 2,
      WORLD.height / 2,
      -Math.PI / 2,
      [loco, createCar("gun", 1), createCar("gun", 1)],
      null,
      (WORLD.maxCars + 2) * WORLD.carSpacing,
    );
    player.throttle = 1;
    return {
      phase: "ready",
      wave: 0,
      gold: ECONOMY.startGold,
      time: 0,
      enemiesAlive: 0,
      enemyCarsAlive: 0,
      player,
      best: loadBest(),
      stats: { kills: 0, trainsDestroyed: 0, goldEarned: 0, carsLost: 0, carsCaptured: 0 },
      waveBanner: 0,
      toast: "",
      toastTimer: 0,
    };
  }

  private restoreProgress(): void {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<SavedRun>;
      if (
        saved.version !== 1 ||
        !saved.player ||
        typeof saved.player !== "object" ||
        !Array.isArray(saved.player.cars) ||
        saved.player.cars.length === 0 ||
        saved.player.cars.length > WORLD.maxCars ||
        !Number.isFinite(saved.wave) ||
        !Number.isFinite(saved.gold) ||
        !Number.isFinite(saved.time) ||
        !Number.isFinite(saved.player.x) ||
        !Number.isFinite(saved.player.y) ||
        !Number.isFinite(saved.player.angle)
      ) {
        localStorage.removeItem(RUN_KEY);
        return;
      }
      const cars = saved.player.cars.map((item, index) => {
        const rawKind = item && typeof item === "object" ? item.kind : undefined;
        const kind = index === 0 ? "engine" : CAR_KINDS.includes(rawKind as CarKind) ? (rawKind as CarKind) : "gun";
        const rawLevel = item && typeof item === "object" ? item.level : 1;
        const level = clamp(Math.floor(finite(rawLevel, 1)), 1, CAR_DEFS[kind].maxLevel);
        const car = createCar(kind, level, index === 0);
        const rawHp = item && typeof item === "object" ? item.hp : car.maxHp;
        car.hp = clamp(finite(rawHp, car.maxHp), 1, car.maxHp);
        const rawCooldown = item && typeof item === "object" ? item.cooldown : 0;
        car.cooldown = clamp(finite(rawCooldown, 0), 0, 60);
        return car;
      });
      const player = createTrain(
        "player",
        clamp(saved.player.x, WORLD.carRadius, WORLD.width - WORLD.carRadius),
        clamp(saved.player.y, WORLD.carRadius, WORLD.height - WORLD.carRadius),
        saved.player.angle,
        cars,
        null,
        (WORLD.maxCars + 2) * WORLD.carSpacing,
      );
      player.speed = clamp(finite(saved.player.speed, 0), 0, 500);
      player.throttle = clamp(finite(saved.player.throttle, 1), 0, 1);
      const wave = Math.max(0, Math.floor(finite(saved.wave, 0)));
      this.snap = {
        ...this.snap,
        phase: "paused",
        // Enemy projectiles are intentionally transient; replay the interrupted
        // wave while preserving its visible number and all durable progression.
        wave,
        gold: Math.max(0, finite(saved.gold, ECONOMY.startGold)),
        time: Math.max(0, finite(saved.time, 0)),
        player,
        stats: restoredStats(saved.stats),
        toast: "Run restored",
        toastTimer: 2.4,
      };
      this.spawnPending = false;
      this.restoredWavePending = wave > 0;
      this.waveTimer = WAVES.betweenDelay;
    } catch {
      try {
        localStorage.removeItem(RUN_KEY);
      } catch {
        /* storage is unavailable */
      }
    }
  }

  saveProgress(): void {
    const phase = this.snap.phase;
    if (phase !== "playing" && phase !== "paused" && phase !== "shop") return;
    const p = this.snap.player;
    const saved: SavedRun = {
      version: 1,
      savedAt: Date.now(),
      wave: this.snap.wave,
      gold: this.snap.gold,
      time: this.snap.time,
      stats: { ...this.snap.stats },
      player: {
        x: p.x,
        y: p.y,
        angle: p.angle,
        speed: p.speed,
        throttle: p.throttle,
        cars: p.cars.map(({ kind, level, hp, maxHp, cooldown }) => ({ kind, level, hp, maxHp, cooldown })),
      },
    };
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify(saved));
    } catch {
      /* storage can be unavailable; the game remains fully playable */
    }
  }

  start(): void {
    if (this.snap.phase !== "ready") return;
    this.snap.phase = "playing";
    this.waveTimer = WAVES.firstDelay;
    this.spawnPending = true;
    this.markDirty();
  }

  restart(): void {
    try {
      localStorage.removeItem(RUN_KEY);
    } catch {
      /* ignore */
    }
    this.snap = this.freshSnapshot();
    this.enemies = [];
    this.bullets = [];
    this.mines = [];
    this.pickups = [];
    this.particles = [];
    this.cows = createCows();
    this.shake = 0;
    this.waveTimer = 0;
    this.spawnPending = false;
    this.restoredWavePending = false;
    this.markDirty();
  }

  pause(): void {
    if (this.snap.phase === "playing") {
      this.snap.phase = "paused";
      this.markDirty();
    }
  }

  resume(): void {
    if (this.snap.phase === "paused" || this.snap.phase === "shop") {
      this.snap.phase = "playing";
      this.markDirty();
    }
  }

  togglePause(): void {
    if (this.snap.phase === "playing") this.pause();
    else if (this.snap.phase === "paused") this.resume();
    else if (this.snap.phase === "shop") this.closeShop();
  }

  openShop(): void {
    const p = this.snap.phase;
    if (p === "playing" || p === "paused") {
      this.phaseBeforeShop = p;
      this.snap.phase = "shop";
      this.markDirty();
    }
  }

  closeShop(): void {
    if (this.snap.phase === "shop") {
      this.snap.phase = this.phaseBeforeShop === "paused" ? "paused" : "playing";
      this.markDirty();
    }
  }

  // ------------------------------------------------------------------- input

  setSteer(s: Steer): void {
    this.snap.player.steer = clampSteer(s);
  }

  steerLeft(): void {
    this.setSteer(-1);
  }

  steerRight(): void {
    this.setSteer(1);
  }

  setThrottle(t: Throttle): void {
    this.snap.player.throttle = Math.max(0, Math.min(1, t));
    this.markDirty();
  }

  cycleThrottle(): void {
    this.snap.player.throttle = this.snap.player.throttle > 0.05 ? 0 : 1;
    this.markDirty();
  }

  // ----------------------------------------------------------------- economy

  carCost(kind: CarKind): number {
    const n = this.snap.player.cars.length;
    return Math.round(CAR_DEFS[kind].baseCost * (1 + 0.06 * (n - 1)));
  }

  canBuy(kind: CarKind): boolean {
    const p = this.snap.player;
    return p.cars.length < this.maxCars && this.snap.gold >= this.carCost(kind);
  }

  buyCar(kind: CarKind): boolean {
    if (!this.canBuy(kind)) return false;
    const cost = this.carCost(kind);
    this.snap.gold -= cost;
    this.snap.player.cars.push(createCar(kind, 1));
    layoutCars(this.snap.player);
    this.markDirty();
    return true;
  }

  private upgradeCostAt(kind: CarKind, level: number): number {
    return Math.round(
      CAR_DEFS[kind].baseCost * ECONOMY.upgradeCostBase * Math.pow(ECONOMY.upgradeCostGrowth, level - 1),
    );
  }

  upgradeCost(car: Car): number {
    return this.upgradeCostAt(car.kind, car.level);
  }

  canUpgrade(car: Car): boolean {
    return car.level < CAR_DEFS[car.kind].maxLevel && this.snap.gold >= this.upgradeCost(car);
  }

  upgradeCar(index: number): boolean {
    const car = this.snap.player.cars[index];
    if (!car || !this.canUpgrade(car)) return false;
    this.snap.gold -= this.upgradeCost(car);
    car.level += 1;
    const newMax = carHpForLevel(car.kind, car.level, index === 0);
    car.hp += newMax - car.maxHp;
    car.maxHp = newMax;
    this.markDirty();
    return true;
  }

  sellValue(car: Car): number {
    let paid = CAR_DEFS[car.kind].baseCost;
    for (let l = 1; l < car.level; l++) paid += this.upgradeCostAt(car.kind, l);
    return Math.round(paid * ECONOMY.sellRatio);
  }

  canSell(index: number): boolean {
    return index >= 1 && index < this.snap.player.cars.length;
  }

  sellCar(index: number): boolean {
    if (!this.canSell(index)) return false;
    const [car] = this.snap.player.cars.splice(index, 1);
    this.snap.gold += this.sellValue(car);
    layoutCars(this.snap.player);
    this.markDirty();
    return true;
  }

  moveCar(index: number, dir: -1 | 1): boolean {
    const cars = this.snap.player.cars;
    const j = index + dir;
    if (index < 1 || j < 1 || j >= cars.length) return false;
    const tmp = cars[index];
    cars[index] = cars[j];
    cars[j] = tmp;
    layoutCars(this.snap.player);
    this.markDirty();
    return true;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private markDirty(): void {
    this.dirty = true;
  }

  flushChanges(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.saveProgress();
    for (const cb of this.listeners) cb();
  }

  private toast(msg: string): void {
    this.snap.toast = msg;
    this.snap.toastTimer = 2.4;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    const snap = this.snap;
    if (snap.phase === "dead") {
      // let the final explosion play out behind the death screen
      updateParticles(this.particles, dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - 40 * dt);
      return;
    }
    if (snap.phase !== "playing") return;
    snap.time += dt;
    if (snap.waveBanner > 0) snap.waveBanner -= dt;
    if (snap.toastTimer > 0) snap.toastTimer -= dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - 40 * dt);

    const player = snap.player;
    moveTrain(player, dt);
    this.emitSmoke(player, dt);
    const loco = player.cars[0];
    if (loco.hp < loco.maxHp) loco.hp = Math.min(loco.maxHp, loco.hp + COMBAT.locoRegen * dt);

    for (const e of this.enemies) {
      updateAi(e, player, dt);
      moveTrain(e, dt);
      this.emitSmoke(e, dt);
    }
    updateCows(this.cows, [player, ...this.enemies], dt);

    this.saveTimer += dt;
    if (this.saveTimer >= 1) {
      this.saveTimer = 0;
      this.saveProgress();
    }

    this.updateCars(player, dt);
    for (const e of this.enemies) this.updateCars(e, dt);

    this.updateBullets(dt);
    this.updateMines(dt);
    this.updateRamming(dt);
    if (!player.alive) {
      this.flushChanges();
      return;
    }
    this.updatePickups(dt);
    updateParticles(this.particles, dt);

    // prune destroyed trains
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      if (!this.enemies[i].alive) {
        this.enemies[i] = this.enemies[this.enemies.length - 1];
        this.enemies.pop();
      }
    }
    snap.enemiesAlive = this.enemies.length;
    let cars = 0;
    for (const e of this.enemies) cars += e.cars.length;
    snap.enemyCarsAlive = cars;

    this.updateWaves(dt);
    this.flushChanges();
  }

  private updateWaves(dt: number): void {
    if (this.enemies.length === 0) {
      if (!this.spawnPending) {
        this.spawnPending = true;
        this.waveTimer = WAVES.betweenDelay;
      }
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        if (this.restoredWavePending) this.restoredWavePending = false;
        else this.snap.wave += 1;
        this.enemies = spawnWave(this.snap.wave, this.snap.player);
        this.snap.waveBanner = WAVES.bannerTime;
        this.spawnPending = false;
        this.markDirty();
      }
    }
  }

  private emitSmoke(train: Train, dt: number): void {
    if (train.speed < 20) return;
    train.smoke -= dt;
    if (train.smoke <= 0) {
      train.smoke = train.throttle > 0.72 ? 0.07 : 0.13;
      const loco = train.cars[0];
      const bx = loco.x + Math.cos(loco.angle) * 8;
      const by = loco.y + Math.sin(loco.angle) * 8;
      smokePuff(this.particles, bx, by, -Math.cos(loco.angle) * train.speed, -Math.sin(loco.angle) * train.speed);
    }
  }

  private opponentsOf(team: Team): Train[] {
    return team === "player" ? this.enemies : [this.snap.player];
  }

  private opponents(train: Train): Train[] {
    return this.opponentsOf(train.team);
  }

  /**
   * Pick a target within range. Enemy gunners shoot whatever is nearest; the
   * player's turrets prefer the frontmost car they can reach, because killing a
   * car derails everything behind it.
   */
  private nearestOpposing(train: Train, x: number, y: number, range: number): Target | null {
    const r2 = range * range;
    const preferFront = train.team === "player";
    let best: Car | null = null;
    let bestTrain: Train | null = null;
    let bestScore = Infinity;
    let bestD = 0;
    for (const t of this.opponents(train)) {
      if (!t.alive) continue;
      const cars = t.cars;
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        const dx = c.x - x;
        const dy = c.y - y;
        const d = dx * dx + dy * dy;
        if (d > r2) continue;
        const score = preferFront ? i * 1e7 + d : d;
        if (score < bestScore) {
          bestScore = score;
          bestD = d;
          best = c;
          bestTrain = t;
        }
      }
    }
    if (!best || !bestTrain) return null;
    this.target.car = best;
    this.target.train = bestTrain;
    this.target.dist = Math.sqrt(bestD);
    return this.target;
  }

  private damageScale(team: Team): number {
    return team === "enemy" ? enemyDamageScale(this.snap.wave) : 1;
  }

  private updateCars(train: Train, dt: number): void {
    const cars = train.cars;
    const scale = this.damageScale(train.team);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      if (car.flash > 0) car.flash -= dt;
      if (car.cooldown > 0) car.cooldown -= dt;
      const def = CAR_DEFS[car.kind];
      const s = def.stats;
      switch (car.kind) {
        case "gun": {
          if (car.cooldown > 0) break;
          const range = (s.range ?? 300) + (s.rangePerLevel ?? 0) * (car.level - 1);
          const t = this.nearestOpposing(train, car.x, car.y, range);
          if (!t) break;
          // two-pass lead along the target's turning arc
          let flight = t.dist / COMBAT.bulletSpeed;
          predictCar(t.car, t.train, flight, aim);
          flight = Math.hypot(aim.x - car.x, aim.y - car.y) / COMBAT.bulletSpeed;
          predictCar(t.car, t.train, flight, aim);
          // enemy gunners are sloppier than yours, so keeping your distance pays off
          const spread = train.team === "enemy" ? COMBAT.enemySpread : COMBAT.playerSpread;
          const a = Math.atan2(aim.y - car.y, aim.x - car.x) + (Math.random() - 0.5) * spread;
          this.bullets.push({
            x: car.x + Math.cos(a) * 12,
            y: car.y + Math.sin(a) * 12,
            vx: Math.cos(a) * COMBAT.bulletSpeed,
            vy: Math.sin(a) * COMBAT.bulletSpeed,
            damage: ((s.damage ?? 10) + (s.damagePerLevel ?? 0) * (car.level - 1)) * scale,
            team: train.team,
            life: COMBAT.bulletLife,
          });
          car.cooldown = cooldownForLevel(s.cooldown ?? 0.5, car.level);
          break;
        }
        case "aoe": {
          if (car.cooldown > 0) break;
          const range = (s.range ?? 150) + (s.rangePerLevel ?? 0) * (car.level - 1);
          if (!this.nearestOpposing(train, car.x, car.y, range)) break;
          const dmg = ((s.damage ?? 20) + (s.damagePerLevel ?? 0) * (car.level - 1)) * scale;
          this.damageArea(train.team, car.x, car.y, range, dmg);
          ring(this.particles, car.x, car.y, range, def.accent);
          burst(this.particles, car.x, car.y, def.accent, 10, 160);
          car.cooldown = cooldownForLevel(s.cooldown ?? 2, car.level);
          break;
        }
        case "trap": {
          if (car.cooldown > 0 || train.speed < 15) break;
          if (this.mines.length >= MAX_MINES) this.mines.shift();
          this.mines.push({
            x: car.x - Math.cos(car.angle) * 14,
            y: car.y - Math.sin(car.angle) * 14,
            team: train.team,
            damage: ((s.damage ?? 40) + (s.damagePerLevel ?? 0) * (car.level - 1)) * scale,
            life: COMBAT.mineLife,
            arm: COMBAT.mineArm,
          });
          car.cooldown = cooldownForLevel(s.cooldown ?? 1.5, car.level);
          break;
        }
        case "health": {
          const heal = ((s.healPerSec ?? 3) + (s.healPerLevel ?? 0) * (car.level - 1)) * dt;
          for (const c of cars) if (c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + heal);
          break;
        }
        case "grapple": {
          this.updateGrapple(train, car, dt);
          break;
        }
        default:
          break;
      }
    }
  }

  private grappleStrength(car: Car): number {
    const s = CAR_DEFS.grapple.stats;
    return (s.grappleStrength ?? 80) + (s.grappleStrengthPerLevel ?? 0) * (car.level - 1);
  }

  private updateGrapple(train: Train, car: Car, dt: number): void {
    const s = CAR_DEFS.grapple.stats;
    if (car.grappleTarget) {
      car.grappleTimer -= dt;
      const victim = this.findCarOwner(car.grappleTarget);
      if (!victim || victim.train.team === train.team) {
        car.grappleTarget = null;
        return;
      }
      const dist = Math.hypot(car.grappleTarget.x - car.x, car.grappleTarget.y - car.y);
      const range = (s.range ?? 300) + (s.rangePerLevel ?? 0) * (car.level - 1);
      if (dist > range * 1.4) {
        car.grappleTarget = null;
        return;
      }
      if (car.grappleTimer <= 0) {
        const target = car.grappleTarget;
        car.grappleTarget = null;
        if (target.hp <= this.grappleStrength(car) && victim.index > 0) {
          this.captureCar(train, victim.train, victim.index);
        } else {
          this.damageCar(victim.train, victim.index, this.grappleStrength(car) * 0.6 * this.damageScale(train.team));
          floatText(this.particles, target.x, target.y - 18, "hook snapped", "#7ff5e0");
        }
      }
      return;
    }
    if (car.cooldown > 0) return;
    const range = (s.range ?? 300) + (s.rangePerLevel ?? 0) * (car.level - 1);
    const strength = this.grappleStrength(car);
    let capturable: Car | null = null;
    let weakest: Car | null = null;
    let weakestHp = Infinity;
    let count = 0;
    const r2 = range * range;
    for (const t of this.opponents(train)) {
      if (!t.alive) continue;
      for (let i = 1; i < t.cars.length; i++) {
        const c = t.cars[i];
        const dx = c.x - car.x;
        const dy = c.y - car.y;
        if (dx * dx + dy * dy > r2) continue;
        if (c.hp <= strength) {
          count++;
          if (Math.random() < 1 / count) capturable = c;
        }
        if (c.hp < weakestHp) {
          weakestHp = c.hp;
          weakest = c;
        }
      }
    }
    const pick = capturable ?? weakest;
    if (!pick) return;
    car.grappleTarget = pick;
    car.grappleTimer = COMBAT.grappleDuration;
    car.cooldown = cooldownForLevel(s.cooldown ?? 8, car.level);
  }

  private findCarOwner(car: Car): { train: Train; index: number } | null {
    const p = this.snap.player;
    let idx = p.cars.indexOf(car);
    if (idx >= 0) return { train: p, index: idx };
    for (const e of this.enemies) {
      idx = e.cars.indexOf(car);
      if (idx >= 0) return { train: e, index: idx };
    }
    return null;
  }

  /** Tear a car off `victim` (everything behind it derails) and couple it to `captor`. */
  private captureCar(captor: Train, victim: Train, index: number): void {
    const car = victim.cars[index];
    // cars behind the stolen one are destroyed per the derail rule
    this.destroyFrom(victim, index + 1);
    victim.cars.length = index;
    layoutCars(victim);
    burst(this.particles, car.x, car.y, CAR_DEFS.grapple.accent, 18, 220);

    const isPlayerCaptor = captor.team === "player";
    if (captor.cars.length >= this.maxCars) {
      if (isPlayerCaptor) {
        const value = this.sellValue(car);
        this.addGold(value, car.x, car.y);
        this.toast(`Train full: salvaged ${CAR_DEFS[car.kind].name} for ${value} gold`);
      }
      return;
    }
    car.grappleTarget = null;
    car.maxHp = carHpForLevel(car.kind, car.level, false);
    car.hp = Math.max(1, Math.round(car.maxHp * 0.6));
    car.cooldown = 0.5;
    captor.cars.push(car);
    layoutCars(captor);
    if (isPlayerCaptor) {
      this.snap.stats.carsCaptured++;
      this.toast(`Captured a ${CAR_DEFS[car.kind].name}!`);
    } else if (victim.team === "player") {
      this.snap.stats.carsLost++;
      this.toast(`They stole your ${CAR_DEFS[car.kind].name}!`);
      this.shake = Math.max(this.shake, 10);
    }
    this.markDirty();
  }

  private damageArea(sourceTeam: Team, x: number, y: number, radius: number, dmg: number): void {
    const r2 = radius * radius;
    for (const t of this.opponentsOf(sourceTeam)) {
      if (!t.alive) continue;
      // iterate from the back so a derail caused by a front car doesn't skip cars
      for (let i = t.cars.length - 1; i >= 0; i--) {
        const c = t.cars[i];
        if (!c) continue;
        const dx = c.x - x;
        const dy = c.y - y;
        if (dx * dx + dy * dy <= r2) this.damageCar(t, i, dmg);
        if (!t.alive) break;
      }
    }
  }

  private updateBullets(dt: number): void {
    const bullets = this.bullets;
    const hitR = (WORLD.carRadius + COMBAT.bulletRadius) ** 2;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WORLD.width || b.y > WORLD.height;
      if (!dead) {
        const targets = b.team === "player" ? this.enemies : [this.snap.player];
        outer: for (const t of targets) {
          if (!t.alive) continue;
          const cars = t.cars;
          for (let j = 0; j < cars.length; j++) {
            const c = cars[j];
            const dx = c.x - b.x;
            const dy = c.y - b.y;
            if (dx * dx + dy * dy < hitR) {
              burst(this.particles, b.x, b.y, b.team === "player" ? "#7fd1ff" : "#ff8a65", 3, 90);
              this.damageCar(t, j, b.damage);
              dead = true;
              break outer;
            }
          }
        }
      }
      if (dead) {
        bullets[i] = bullets[bullets.length - 1];
        bullets.pop();
      }
    }
  }

  private updateMines(dt: number): void {
    const mines = this.mines;
    const trig = COMBAT.mineTrigger + WORLD.carRadius;
    const trig2 = trig * trig;
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i];
      m.life -= dt;
      if (m.arm > 0) m.arm -= dt;
      let dead = m.life <= 0;
      if (!dead && m.arm <= 0) {
        const targets = m.team === "player" ? this.enemies : [this.snap.player];
        outer: for (const t of targets) {
          if (!t.alive) continue;
          for (const c of t.cars) {
            const dx = c.x - m.x;
            const dy = c.y - m.y;
            if (dx * dx + dy * dy < trig2) {
              this.explodeMine(m);
              dead = true;
              break outer;
            }
          }
        }
      }
      if (dead) {
        mines[i] = mines[mines.length - 1];
        mines.pop();
      }
    }
  }

  private explodeMine(m: Mine): void {
    this.damageArea(m.team, m.x, m.y, COMBAT.mineRadius, m.damage);
    burst(this.particles, m.x, m.y, "#ffb067", 16, 230);
    ring(this.particles, m.x, m.y, COMBAT.mineRadius, "#ffb067");
    if (m.team === "enemy") this.shake = Math.max(this.shake, 6);
  }

  private updateRamming(dt: number): void {
    const player = this.snap.player;
    const r = WORLD.carRadius * 1.7;
    const r2 = r * r;
    const dmg = COMBAT.ramDps * dt;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      // coarse reject using locomotive distance vs. train lengths
      const span = (player.cars.length + e.cars.length) * WORLD.carSpacing + 60;
      if (Math.hypot(e.x - player.x, e.y - player.y) > span) continue;
      for (let i = e.cars.length - 1; i >= 0 && e.alive; i--) {
        const ec = e.cars[i];
        if (!ec) continue;
        for (let j = player.cars.length - 1; j >= 0 && player.alive; j--) {
          const pc = player.cars[j];
          if (!pc) continue;
          const dx = ec.x - pc.x;
          const dy = ec.y - pc.y;
          if (dx * dx + dy * dy < r2) {
            const speedScale = 0.6 + Math.max(e.speed, player.speed) / 200;
            if (Math.random() < 0.25) burst(this.particles, (ec.x + pc.x) / 2, (ec.y + pc.y) / 2, "#ffd27f", 2, 120);
            this.damageCar(e, i, dmg * speedScale);
            this.damageCar(player, j, dmg * speedScale);
            if (!e.alive || !e.cars[i]) break;
          }
        }
      }
    }
  }

  private updatePickups(dt: number): void {
    const p = this.snap.player;
    const loco = p.cars[0];
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      k.life -= dt;
      k.bob += dt;
      let dead = k.life <= 0;
      if (!dead && Math.hypot(k.x - loco.x, k.y - loco.y) < WORLD.carRadius + 16) {
        this.collectPickup(k);
        dead = true;
      }
      if (dead) {
        this.pickups[i] = this.pickups[this.pickups.length - 1];
        this.pickups.pop();
      }
    }
  }

  private collectPickup(k: Pickup): void {
    const p = this.snap.player;
    const def = CAR_DEFS[k.kind];
    burst(this.particles, k.x, k.y, def.accent, 14, 180);
    if (p.cars.length < this.maxCars) {
      p.cars.push(createCar(k.kind, 1));
      layoutCars(p);
      this.toast(`Coupled a ${def.name}`);
    } else {
      const value = Math.round(def.baseCost * 0.5);
      this.addGold(value, k.x, k.y);
      this.toast(`Train full: crate salvaged for ${value} gold`);
    }
    this.markDirty();
  }

  private addGold(amount: number, x: number, y: number): void {
    if (amount <= 0) return;
    this.snap.gold += amount;
    this.snap.stats.goldEarned += amount;
    floatText(this.particles, x, y - 14, `+${amount}`, "#ffe66d");
    this.markDirty();
  }

  private killReward(isLoco: boolean): number {
    const base = (ECONOMY.killBase + ECONOMY.killPerWave * this.snap.wave) * (isLoco ? ECONOMY.locoMultiplier : 1);
    return Math.round(base * (1 + goldBonus(this.snap.player)));
  }

  damageCar(train: Train, index: number, amount: number): void {
    const car = train.cars[index];
    if (!car || !train.alive) return;
    car.hp -= amount;
    car.flash = 0.12;
    if (car.hp <= 0) {
      this.destroyFrom(train, index);
    }
  }

  /** Destroy cars[index] and everything behind it. index 0 kills the train. */
  private destroyFrom(train: Train, index: number): void {
    const cars = train.cars;
    if (index >= cars.length) return;
    const isEnemy = train.team === "enemy";
    const cargo: CarKind[] = [];
    const lost = cars.length - index;
    let gold = 0;
    for (let i = cars.length - 1; i >= index; i--) {
      const c = cars[i];
      const def = CAR_DEFS[c.kind];
      burst(this.particles, c.x, c.y, def.accent, i === 0 ? 34 : 14, i === 0 ? 300 : 190);
      burst(this.particles, c.x, c.y, "#ffb067", 8, 140);
      if (isEnemy) {
        gold += this.killReward(i === 0);
        this.snap.stats.kills++;
        if (i > 0) cargo.push(c.kind);
      } else {
        this.snap.stats.carsLost++;
      }
      c.grappleTarget = null;
    }
    const first = cars[index];
    if (isEnemy && gold > 0) this.addGold(gold, first.x, first.y);
    cars.length = index;

    if (index === 0) {
      train.alive = false;
      ring(this.particles, first.x, first.y, 70, "#ffffff");
      if (isEnemy) {
        this.snap.stats.trainsDestroyed++;
        this.shake = Math.max(this.shake, 8);
        this.dropCrate(first.x, first.y, cargo);
      } else {
        this.die();
      }
    } else if (!isEnemy) {
      this.shake = Math.max(this.shake, 7);
      this.toast(lost === 1 ? "Lost a car" : `Lost ${lost} cars: everything behind the hit derailed`);
    }
    this.markDirty();
  }

  /** A destroyed locomotive drops a crate holding one of the cars it was pulling. */
  private dropCrate(x: number, y: number, cargo: CarKind[]): void {
    const pool = cargo.length ? cargo : CAR_KINDS.filter((k) => k !== "grapple");
    const kind = pool[Math.floor(Math.random() * pool.length)];
    this.pickups.push({ x, y, kind, life: COMBAT.pickupLife, bob: 0 });
  }

  private die(): void {
    const snap = this.snap;
    snap.phase = "dead";
    try {
      localStorage.removeItem(RUN_KEY);
    } catch {
      /* ignore */
    }
    this.shake = 16;
    const best = snap.best;
    if (snap.wave > best.wave || (snap.wave === best.wave && snap.time > best.time)) {
      snap.best = { wave: snap.wave, time: snap.time, gold: snap.stats.goldEarned };
      saveBest(snap.best);
    }
    this.markDirty();
  }
}
