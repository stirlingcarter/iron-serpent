# RAILGUN

A browser survival game: you drive an armed train around an arena and try to outlast
endless waves of enemy trains. Runs entirely in the browser (Canvas 2D, no backend) and
deploys to GitHub Pages.

## How it plays

- **Steer** by holding LEFT or RIGHT; release to straighten out. Keyboard steering works the
  same way with held `A` / `D` or arrow keys.
- **Speed** is continuous: drag the range control to any setting, or use the keyboard
  to nudge it up and down.
- Your cars follow the locomotive's exact path, snake-style.
- Solid arena walls guide a train into the wall's tangent, so it can ride along the fence
  without taking damage or getting stuck.
- The arena is procedurally generated terrain (deterministic per `TERRAIN.seed`): rolling hills,
  mountain ranges, valleys, terraced mesas with cliff faces, and winding ravines. The spawn area
  is always flat and open.
  - Each car feels the slope under its own bogies; their weighted average sets the train's
    grade. Climbing is slow, descending is fast, and on a crest the cars still climbing hold the
    train back while those past it pull it forward.
  - Uphill cliff faces act like the fence and guide the train along them. Run over a downhill
    cliff or ravine edge and the cars fall (no steering mid-air) and land; nothing takes damage.
    Very steep side slopes make the locomotive slide downhill.
- Cows wander the grass and flee when a train comes close.
- Every car has HP. When a car is destroyed, **everything behind it derails**. You lose when
  the locomotive dies.
- Enemy trains arrive in **waves** (usually one train, sometimes two or three), built from the
  same cars you use, with tougher loadouts as waves go on. The next wave rolls in seconds after
  the last one is destroyed; only death shows a screen.
- Killing enemy cars pays **gold**. Destroying an enemy locomotive drops a crate that couples a
  new car to your train.
- Your turrets aim at the frontmost enemy car in range, so getting the locomotive in range is
  the fastest way to derail a whole train. Enemy gunners are less accurate at long range;
  keeping your distance is a real defence.
- Open the **Depot** (shop) at any time to buy, sell, upgrade and reorder cars.
- The current test tuning starts the player with **5,000 gold** and allows up to **1,000 cars**.

### Cars

| Car | What it does |
| --- | --- |
| Engine | Extra thrust; more engines, faster train |
| Turret | Auto-targets and shoots the nearest enemy car |
| Rocket Car | Slow rockets with splash damage; long cooldown. Bursts over the predicted aim point if it touches nothing on the way |
| Sniper Car | Very long range, heavy single hits, slow fire. Targets the enemy car with the most HP left in range (locomotives count double) |
| Tesla Coil | Periodic area zap hitting every enemy car in range |
| Mine Layer | Drops mines behind you that enemies detonate |
| Vault | Increases gold per kill |
| Repair Car | Slowly heals every car on the train |
| Grappler | Hooks a weakened enemy car, tears it off their train (derailing everything behind it) and couples it to yours |

### Controls

| Action | Touch / mouse | Keyboard |
| --- | --- | --- |
| Steer continuously | Hold LEFT / RIGHT buttons | Hold `←` `→` or `A` `D` |
| Set speed | Drag the SPEED slider | `W` / `↑` faster, `S` / `↓` slower |
| Stop / full speed | SPEED slider | `Space` toggles stop/full |
| Depot (shop) | SHOP button | `B` |
| Pause | PAUSE button | `P` or `Esc` |
| Start / restart | START button | `Enter` |

## Run locally

Requires Node.js `^20.19` or `>=22.12`.

```bash
npm install
npm run dev      # http://127.0.0.1:4517 (also available on the local network)
```

```bash
npm run build    # production build in dist/
npm run preview  # serve dist/ on http://localhost:4518
```

Active runs are saved to versioned browser `localStorage` once per second and whenever the
page is hidden or unloaded. Reloading restores the run paused, including the current wave,
gold, elapsed time, car order/levels/health, and speed setting. Transient enemies and
projectiles are not serialized; the interrupted wave restarts when play resumes. Starting
over or losing the locomotive clears the active-run save.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds the site on every push to `main` and
publishes it with GitHub Pages. One-time setup in the repository:

1. Settings → Pages → **Build and deployment** → Source: **GitHub Actions**.
2. Push to `main` (or run the workflow manually). The site is published at
   `https://<user>.github.io/<repo>/`.

The Vite `base` path is derived from the repository name inside the workflow, so no config
changes are needed when the repo is renamed. Note that GitHub Pages on a **private** repository
requires GitHub Pro, Team or Enterprise; on a free plan, make the repo public to publish.

## Project layout

```
src/
  main.ts          boot, fixed-timestep loop
  render.ts        Canvas 2D renderer
  terrainRender.ts baked hill-shaded terrain texture
  ui.ts            HUD, controls, overlays, shop (DOM)
  input.ts         keyboard bindings
  game/
    types.ts       shared types and the GameApi contract
    config.ts      tuning: cars, movement, economy, waves
    game.ts        simulation: combat, derail rules, waves, economy
    train.ts       train movement and snake-style car layout
    terrain.ts     procedural heightfield generation and sampling
    terrainPhysics.ts  slope speed, cliff guidance, falling
    trail.ts       locomotive path ring buffer
    enemies.ts     wave generation and enemy AI
    cows.ts        lightweight ambient cow movement
    effects.ts     particles
```
