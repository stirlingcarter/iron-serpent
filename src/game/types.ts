export type Team = "player" | "enemy";

export type CarKind =
  | "engine"
  | "gun"
  | "aoe"
  | "trap"
  | "gold"
  | "health"
  | "grapple"
  | "rocket"
  | "sniper"
  | "booster"
  | "armor"
  | "coupler";

/** Continuous steering input: -1 full left, 0 straight, 1 full right. */
export type Steer = number;
/** Continuous throttle input: 0 = stop, 1 = full speed. */
export type Throttle = number;

export interface CarStats {
  damage?: number;
  damagePerLevel?: number;
  cooldown?: number;
  range?: number;
  rangePerLevel?: number;
  speedBonus?: number;
  speedBonusPerLevel?: number;
  goldBonus?: number;
  goldBonusPerLevel?: number;
  healPerSec?: number;
  healPerLevel?: number;
  /** grapple: max HP of a car it can tear off and capture */
  grappleStrength?: number;
  grappleStrengthPerLevel?: number;
  /** rocket: blast radius of each warhead */
  splashRadius?: number;
  splashRadiusPerLevel?: number;
  /** booster: raw max-HP bonus fraction contributed to the whole train (before the cap curve) */
  hpBoost?: number;
  hpBoostPerLevel?: number;
  /** armor: raw damage-reduction fraction contributed to the whole train (before the cap curve) */
  armor?: number;
  armorPerLevel?: number;
}

/** Train-wide aura totals, recomputed in one pass over the cars each step. */
export interface TrainBuffs {
  /** max-HP multiplier applied to every car */
  hpMult: number;
  /** fraction of incoming damage removed, 0..BUFFS.armorCap */
  armor: number;
  /** HP per second repaired on every car */
  heal: number;
}

export interface CarDef {
  kind: CarKind;
  name: string;
  glyph: string;
  description: string;
  color: string;
  accent: string;
  baseCost: number;
  baseHp: number;
  hpPerLevel: number;
  maxLevel: number;
  stats: CarStats;
}

export interface Car {
  id: number;
  kind: CarKind;
  level: number;
  hp: number;
  /** baseMaxHp scaled by the train's HP multiplier */
  maxHp: number;
  /** max HP before train buffs */
  baseMaxHp: number;
  /** the HP multiplier maxHp currently reflects */
  hpMult: number;
  x: number;
  y: number;
  angle: number;
  /** pose at the start of the latest physics step, for render interpolation */
  prevX: number;
  prevY: number;
  prevAngle: number;
  /** seconds until this car can act again */
  cooldown: number;
  /** damage flash timer (seconds) */
  flash: number;
  /** grapple runtime */
  grappleTarget: Car | null;
  grappleTimer: number;
  /** terrain: body height (NaN until first settled), vertical speed, nose-up pitch in radians */
  z: number;
  vz: number;
  pitch: number;
}

export interface AiState {
  /** seconds until next decision */
  think: number;
  /** orbit direction and preferred distance */
  orbitDir: 1 | -1;
  orbitDist: number;
  wander: number;
}

export interface Train {
  id: number;
  team: Team;
  cars: Car[];
  x: number;
  y: number;
  angle: number;
  speed: number;
  steer: Steer;
  throttle: Throttle;
  alive: boolean;
  /** total distance travelled by the locomotive */
  odometer: number;
  trail: Trail;
  ai: AiState | null;
  /** smoke puff timer */
  smoke: number;
  /** weighted mean slope under the cars along their heading (+ = uphill) */
  grade: number;
  /** impact speed of the locomotive's latest landing, cleared once effects play */
  landing: number;
  buffs: TrainBuffs;
}

/** Ring buffer of locomotive positions used to lay cars out snake-style. */
export interface Trail {
  /** Float64: `ss` holds the unbounded odometer, which outgrows float32 precision within minutes. */
  xs: Float64Array;
  ys: Float64Array;
  ss: Float64Array;
  /** index of the most recent sample */
  head: number;
  /** number of valid samples */
  count: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  team: Team;
  life: number;
  kind: "bullet" | "rocket" | "sniper";
  /** rocket blast radius; 0 for direct-hit rounds */
  splash: number;
}

export interface Mine {
  x: number;
  y: number;
  team: Team;
  damage: number;
  life: number;
  /** seconds until armed */
  arm: number;
}

export interface Pickup {
  x: number;
  y: number;
  kind: CarKind;
  life: number;
  bob: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "smoke" | "ring" | "text";
  text?: string;
}

export interface Cow {
  x: number;
  y: number;
  angle: number;
  speed: number;
  think: number;
  wander: number;
}

export type Phase = "ready" | "playing" | "paused" | "shop" | "dead";

export interface BestRun {
  wave: number;
  time: number;
  gold: number;
}

export interface RunStats {
  kills: number;
  trainsDestroyed: number;
  goldEarned: number;
  carsLost: number;
  carsCaptured: number;
}

export interface GameSnapshot {
  phase: Phase;
  wave: number;
  gold: number;
  time: number;
  enemiesAlive: number;
  enemyCarsAlive: number;
  player: Train;
  best: BestRun;
  stats: RunStats;
  /** seconds remaining to show the "Wave N" banner (0 = hidden) */
  waveBanner: number;
  /** transient toast message, e.g. "Captured a Turret!" */
  toast: string;
  toastTimer: number;
}

/**
 * The surface the DOM UI talks to. The game owns all state; the UI only reads
 * `snap` and calls these methods.
 */
export interface GameApi {
  readonly snap: GameSnapshot;
  readonly maxCars: number;

  start(): void;
  restart(): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  openShop(): void;
  closeShop(): void;

  setSteer(s: Steer): void;
  steerLeft(): void;
  steerRight(): void;
  setThrottle(t: Throttle): void;
  cycleThrottle(): void;
  saveProgress(): void;

  carCost(kind: CarKind): number;
  canBuy(kind: CarKind): boolean;
  buyCar(kind: CarKind): boolean;

  upgradeCost(car: Car): number;
  canUpgrade(car: Car): boolean;
  upgradeCar(index: number): boolean;

  sellValue(car: Car): number;
  canSell(index: number): boolean;
  sellCar(index: number): boolean;

  moveCar(index: number, dir: -1 | 1): boolean;

  /** Subscribe to coarse state changes (gold, cars, phase, wave). */
  onChange(cb: () => void): () => void;
}
