import "./style.css";
import { Game } from "./game/game";
import { bindKeyboard } from "./input";
import { Renderer } from "./render";
import { mountUi } from "./ui";

const STEP = 1 / 60;
const MAX_STEPS = 5;

function boot(): void {
  const canvas = document.getElementById("game") as HTMLCanvasElement | null;
  const uiRoot = document.getElementById("ui");
  if (!canvas || !uiRoot) throw new Error("Missing #game canvas or #ui root");

  const game = new Game();
  const renderer = new Renderer(canvas);
  renderer.snapCamera(game);
  const ui = mountUi(uiRoot, game);
  bindKeyboard(game);
  if (import.meta.env.DEV) {
    (window as unknown as { __railgun: Game }).__railgun = game;
  }

  // Re-centre the camera when a new run begins.
  game.onChange(() => {
    if (game.snap.phase === "ready") renderer.snapCamera(game);
  });

  // Persist before browsers freeze or discard the page. Pausing on hide also
  // prevents an active run from advancing while its tab is in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      game.pause();
      game.saveProgress();
    }
  });
  window.addEventListener("pagehide", () => game.saveProgress());

  let last = performance.now();
  let acc = 0;
  const loop = (now: number) => {
    let frame = (now - last) / 1000;
    last = now;
    if (frame > 0.25) frame = 0.25;
    acc += frame;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      game.update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    game.flushChanges();
    renderer.draw(game, frame, acc / STEP);
    ui.tick(frame);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot();
