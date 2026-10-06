import type { CarDef, CarKind } from "./types";

export const WORLD = {
  width: 3600,
  height: 3600,
  /** px of locomotive travel between trail samples */
  trailStep: 3,
  carSpacing: 36,
  carLength: 30,
  carWidth: 18,
  carRadius: 15,
  maxCars: 1000,
};

export const MOVEMENT = {
  /** px/s at the old cruise setting; full analog throttle is faster */
  baseSpeed: 125,
  fastMultiplier: 1.6,
  /**
   * px/s deducted from top speed per non-engine car (locomotive and engine cars
   * exempt). Extra engines have to pay for a long cargo string.
   */
  carDrag: 3.5,
  /** floor on (baseSpeed + bonuses) before the fast multiplier, so drag can't stall a train */
  minPoweredSpeed: 48,
  /** rad/s at full steering input */
  turnRate: 2.15,
  /** px turning radius held above stock full speed, so extra engines don't widen turns much */
  turnRadius: 104,
  /** speed at which turnRadius applies unwidened (stock full throttle) */
  turnRadiusRefSpeed: 200,
  /** radius grows by this fraction per extra turnRadiusRefSpeed of speed */
  turnRadiusWiden: 0.15,
  /** hard cap on angular velocity, rad/s */
  maxTurnRate: 5,
  accel: 260,
  brake: 420,
};

export const ECONOMY = {
  startGold: 5000,
  /** gold per enemy car at wave w: base + perWave * w */
  killBase: 14,
  killPerWave: 4,
  locoMultiplier: 3,
  sellRatio: 0.6,
  upgradeCostBase: 0.65,
  upgradeCostGrowth: 1.45,
};

export const COMBAT = {
  bulletSpeed: 700,
  bulletLife: 0.9,
  bulletRadius: 6,
  /** aim jitter in radians (total width) */
  playerSpread: 0.03,
  enemySpread: 0.3,
  mineLife: 26,
  mineArm: 0.8,
  mineRadius: 44,
  mineTrigger: 18,
  ramDps: 14,
  pickupLife: 30,
  /** locomotive HP for the player's starting engine */
  locoHp: 420,
  locoHpPerLevel: 90,
  /** innate self-repair of the player's locomotive, HP per second */
  locoRegen: 2.5,
  grappleDuration: 0.75,
  /** rockets fly slowly and burst at the predicted aim point if they miss */
  rocketSpeed: 330,
  rocketRadius: 8,
  rocketSpread: 0.05,
  /** sniper rounds are near-hitscan; hits are swept so they cannot tunnel */
  sniperSpeed: 1600,
  /** sniper target score multiplier for a locomotive (killing it derails the train) */
  sniperLocoWeight: 2,
};

/** Enemy weapons start soft and ramp up so early waves teach rather than punish. */
export function enemyDamageScale(wave: number): number {
  return Math.min(1.35, 0.45 + 0.045 * wave);
}

export const WAVES = {
  firstDelay: 1.5,
  betweenDelay: 3.0,
  bannerTime: 2.4,
  budgetBase: 100,
  budgetPerWave: 34,
  hpScalePerWave: 0.06,
  spawnMargin: 220,
  /** minimum distance from the player a wave spawns at */
  spawnDistance: 1100,
};

export const CAR_DEFS: Record<CarKind, CarDef> = {
  engine: {
    kind: "engine",
    name: "Engine",
    glyph: "E",
    description:
      "Adds thrust. Every other car drags the train a little; engines do not. More engines, faster train. Sturdy.",
    color: "#c0392b",
    accent: "#ff7b6b",
    baseCost: 120,
    baseHp: 200,
    hpPerLevel: 45,
    maxLevel: 5,
    stats: { speedBonus: 16, speedBonusPerLevel: 6 },
  },
  gun: {
    kind: "gun",
    name: "Turret",
    glyph: "T",
    description: "Auto-targets the nearest enemy car and shoots.",
    color: "#2980b9",
    accent: "#7fd1ff",
    baseCost: 80,
    baseHp: 110,
    hpPerLevel: 22,
    maxLevel: 6,
    stats: { damage: 11, damagePerLevel: 4, cooldown: 0.42, range: 330, rangePerLevel: 20 },
  },
  aoe: {
    kind: "aoe",
    name: "Tesla Coil",
    glyph: "Z",
    description: "Periodically zaps every enemy car in a radius.",
    color: "#8e44ad",
    accent: "#e0a7ff",
    baseCost: 170,
    baseHp: 115,
    hpPerLevel: 24,
    maxLevel: 6,
    stats: { damage: 28, damagePerLevel: 10, cooldown: 2.2, range: 160, rangePerLevel: 16 },
  },
  trap: {
    kind: "trap",
    name: "Mine Layer",
    glyph: "M",
    description: "Drops mines on the track behind you. Enemies that cross them explode.",
    color: "#d35400",
    accent: "#ffb067",
    baseCost: 115,
    baseHp: 105,
    hpPerLevel: 22,
    maxLevel: 6,
    stats: { damage: 55, damagePerLevel: 20, cooldown: 1.7 },
  },
  gold: {
    kind: "gold",
    name: "Vault",
    glyph: "$",
    description: "Every kill pays out more gold. Fragile.",
    color: "#b7950b",
    accent: "#ffe66d",
    baseCost: 100,
    baseHp: 90,
    hpPerLevel: 18,
    maxLevel: 5,
    stats: { goldBonus: 0.3, goldBonusPerLevel: 0.15 },
  },
  health: {
    kind: "health",
    name: "Repair Car",
    glyph: "+",
    description: "Slowly repairs every car on the train. Heavily armored.",
    color: "#27ae60",
    accent: "#8ff0b4",
    baseCost: 140,
    baseHp: 240,
    hpPerLevel: 50,
    maxLevel: 5,
    stats: { healPerSec: 3.5, healPerLevel: 2 },
  },
  grapple: {
    kind: "grapple",
    name: "Grappler",
    glyph: "G",
    description:
      "Hooks a weakened enemy car, tears it off their train and couples it to the back of yours. Everything behind it derails.",
    color: "#16a085",
    accent: "#7ff5e0",
    baseCost: 260,
    baseHp: 130,
    hpPerLevel: 26,
    maxLevel: 5,
    stats: { range: 300, rangePerLevel: 20, cooldown: 8, grappleStrength: 95, grappleStrengthPerLevel: 55 },
  },
  rocket: {
    kind: "rocket",
    name: "Rocket Car",
    glyph: "R",
    description: "Lobs slow rockets at the frontmost enemy car in range. Each blast damages every car around the impact.",
    color: "#7f8c3a",
    accent: "#f4e04d",
    baseCost: 190,
    baseHp: 120,
    hpPerLevel: 24,
    maxLevel: 6,
    stats: {
      damage: 34,
      damagePerLevel: 12,
      cooldown: 2.6,
      range: 430,
      rangePerLevel: 25,
      splashRadius: 62,
      splashRadiusPerLevel: 6,
    },
  },
  sniper: {
    kind: "sniper",
    name: "Sniper Car",
    glyph: "S",
    description: "Very long range, slow fire. Picks off the toughest enemy car it can see, locomotives first.",
    color: "#3d4a5c",
    accent: "#ff5c8a",
    baseCost: 210,
    baseHp: 95,
    hpPerLevel: 18,
    maxLevel: 6,
    stats: { damage: 90, damagePerLevel: 32, cooldown: 3.4, range: 760, rangePerLevel: 40 },
  },
  booster: {
    kind: "booster",
    name: "Hull Booster",
    glyph: "H",
    description: "Raises max HP of every car on the train, locomotive included. Stacks with diminishing returns up to double HP.",
    color: "#a23b72",
    accent: "#ff9ecf",
    baseCost: 160,
    baseHp: 150,
    hpPerLevel: 30,
    maxLevel: 5,
    stats: { hpBoost: 0.12, hpBoostPerLevel: 0.05 },
  },
  armor: {
    kind: "armor",
    name: "Armor Car",
    glyph: "A",
    description: "Cuts damage taken by every car on the train. Stacks with diminishing returns up to 60% reduction.",
    color: "#5d6d7e",
    accent: "#d5dde6",
    baseCost: 175,
    baseHp: 210,
    hpPerLevel: 40,
    maxLevel: 5,
    stats: { armor: 0.06, armorPerLevel: 0.025 },
  },
  coupler: {
    kind: "coupler",
    name: "Re-Coupler",
    glyph: "&",
    description:
      "Segment car: when anything ahead of it is destroyed or stolen, cars between the break and this Re-Coupler are lost, then it snaps forward onto the next surviving car and everything behind it stays coupled. If the Re-Coupler itself dies, normal derail rules apply (unless another Re-Coupler is further back).",
    color: "#6e4b2a",
    accent: "#f0c674",
    baseCost: 150,
    baseHp: 170,
    hpPerLevel: 40,
    maxLevel: 5,
    stats: {},
  },
  guard: {
    kind: "guard",
    name: "Cattle Guard",
    glyph: "V",
    description:
      "Fits a cow-catcher to your locomotive that absorbs one mine blast completely, then regrows. The train holds one charge at most; extra Cattle Guards only recharge it faster.",
    color: "#8c6f1f",
    accent: "#ffd166",
    baseCost: 145,
    baseHp: 140,
    hpPerLevel: 28,
    maxLevel: 5,
    stats: { guardRate: 1, guardRatePerLevel: 0.3 },
  },
};

/**
 * Train-wide aura stacking. Each buff car adds its raw value to a per-train
 * sum; the effective bonus is `cap * (1 - exp(-sum / cap))`, which is close to
 * the plain sum for a few cars and approaches `cap` asymptotically.
 */
export const BUFFS = {
  /** max-HP multiplier tops out at 1 + hpBoostCap */
  hpBoostCap: 1.0,
  /** damage reduction tops out at this fraction */
  armorCap: 0.6,
  /**
   * Cattle guard: a single charge per train, never queued. The summed guard
   * rate R (1 per Lv1 car, +guardRatePerLevel per level) sets the regrow time
   * to max(guardMinRecharge, guardRecharge / R^guardStackExponent).
   */
  guardRecharge: 16,
  guardMinRecharge: 4,
  guardStackExponent: 0.6,
};

export const CAR_KINDS: CarKind[] = [
  "gun",
  "rocket",
  "sniper",
  "aoe",
  "trap",
  "grapple",
  "engine",
  "health",
  "booster",
  "armor",
  "coupler",
  "guard",
  "gold",
];

export function cooldownForLevel(base: number, level: number): number {
  return base * Math.pow(0.92, level - 1);
}

/**
 * Terrain tuning. Heights are in world px, so a slope of 1 rises one px per px
 * travelled (45 degrees).
 */
export const TERRAIN = {
  /** change to get a different (still deterministic) map */
  seed: 1337,
  /** heightfield sample spacing in px */
  cell: 8,
  baseHeight: 120,
  hillScale: 950,
  hillAmp: 100,
  regionScale: 1250,
  mountainScale: 820,
  mountainAmp: 420,
  valleyDepth: 80,
  cliffScale: 1100,
  /** height of one terrace (mesa) step */
  terraceStep: 55,
  /** fraction of each terrace step spent rising; smaller = sheerer cliffs */
  terraceRise: 0.12,
  ravineScale: 900,
  /** ravine half-width in noise units */
  ravineWidth: 0.15,
  ravineDepth: 95,
  /** flat, open ground around the spawn point */
  spawnRadius: 360,
  spawnBlend: 300,

  /** grade multiplier: target speed is scaled by 1 - gradeEffect * mean slope */
  gradeEffect: 1.9,
  minGradeFactor: 0.26,
  maxGradeFactor: 1.85,
  /** px/s^2 used when a train is above its grade-adjusted target speed */
  gradeDecel: 150,
  /** px/s^2 when above the throttle setting itself (e.g. after a descent) */
  coastDecel: 230,
  /** locomotive counts this many times in the train's mean slope */
  locoGradeWeight: 2,
  /** uphill rise per px beyond which ground acts like a wall */
  cliffSlope: 1.6,
  /** ground falling away faster than this per px of travel launches a car */
  fallSlope: 1.5,
  /** ...and by more than this many px in one step, so small kinks don't cause hops */
  fallMinDrop: 5,
  gravity: 1300,
  /** cross-slope steeper than this makes the locomotive slide sideways */
  slideSlope: 0.75,
  /** px/s of sideways slide per unit of cross-slope beyond slideSlope */
  slideRate: 70,
  /** landing impact (px/s) that costs speed and shakes the camera */
  hardLanding: 260,
  /** fraction of speed kept after a hard landing */
  hardLandingSpeed: 0.8,
};
