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
  /** rad/s at full steering input */
  turnRate: 2.15,
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
    description: "Adds thrust. More engines, faster train. Sturdy.",
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
};

export const CAR_KINDS: CarKind[] = ["gun", "aoe", "trap", "grapple", "engine", "health", "gold"];

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
  gravity: 1300,
  /** cross-slope steeper than this makes the locomotive slide sideways */
  slideSlope: 0.75,
  /** px/s of sideways slide per unit of cross-slope beyond slideSlope */
  slideRate: 70,
  /** landing impact (px/s) that costs speed and shakes the camera */
  hardLanding: 260,
};
