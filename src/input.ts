import type { GameApi } from "./game/types";

/** Keyboard bindings for desktop play. Touch/pointer controls live in the DOM UI. */
export function bindKeyboard(game: GameApi): () => void {
  let left = false;
  let right = false;

  const updateSteer = () => {
    if (game.snap.phase !== "playing") {
      game.setSteer(0);
      return;
    }
    game.setSteer(left === right ? 0 : left ? -1 : 1);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
    const phase = game.snap.phase;
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        left = true;
        updateSteer();
        e.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        right = true;
        updateSteer();
        e.preventDefault();
        break;
      case "ArrowUp":
      case "KeyW":
        if (phase === "playing") game.setThrottle(game.snap.player.throttle + 0.05);
        e.preventDefault();
        break;
      case "ArrowDown":
      case "KeyS":
        if (phase === "playing") game.setThrottle(game.snap.player.throttle - 0.05);
        e.preventDefault();
        break;
      case "Space":
        if (e.repeat) break;
        if (phase === "playing") game.cycleThrottle();
        else if (phase === "ready") game.start();
        e.preventDefault();
        break;
      case "KeyB":
        if (e.repeat) break;
        if (phase === "shop") game.closeShop();
        else game.openShop();
        break;
      case "KeyP":
        if (e.repeat) break;
        game.togglePause();
        break;
      case "Escape":
        if (e.repeat) break;
        if (phase === "shop") game.closeShop();
        else game.togglePause();
        break;
      case "Enter":
        if (e.repeat) break;
        if (phase === "ready") game.start();
        else if (phase === "dead") {
          game.restart();
          game.start();
        }
        break;
      default:
        return;
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      left = false;
      updateSteer();
      e.preventDefault();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      right = false;
      updateSteer();
      e.preventDefault();
    }
  };

  const onBlur = () => {
    left = false;
    right = false;
    game.setSteer(0);
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}
