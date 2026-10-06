import type { Car, CarKind, GameApi, Phase, Train } from "./game/types";
import { CAR_DEFS, CAR_KINDS, WAVES } from "./game/config";

export interface UiHandle {
  tick(dt: number): void;
}

const GOLD = "◆";
/* ------------------------------------------------------------------ */
/* DOM helpers                                                         */
/* ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Returns a setter that only touches the DOM when the value changes. */
function textCell(node: Element): (value: string) => void {
  let last: string | null = null;
  return (value) => {
    if (value === last) return;
    last = value;
    node.textContent = value;
  };
}

function classCell(node: Element, cls: string): (on: boolean) => void {
  let last: boolean | null = null;
  return (on) => {
    if (on === last) return;
    last = on;
    node.classList.toggle(cls, on);
  };
}

function styleCell(node: HTMLElement, prop: string): (value: string) => void {
  let last: string | null = null;
  return (value) => {
    if (value === last) return;
    last = value;
    node.style.setProperty(prop, value);
  };
}

interface ButtonOptions {
  /** Fire on pointerdown instead of click (for the control dock). */
  instant?: boolean;
  title?: string;
  ariaLabel?: string;
}

function button(
  label: string,
  className: string,
  onPress: () => void,
  opts: ButtonOptions = {},
): HTMLButtonElement {
  const b = el("button", className ? `btn ${className}` : "btn", label);
  b.type = "button";
  if (opts.title) b.title = opts.title;
  if (opts.ariaLabel) b.setAttribute("aria-label", opts.ariaLabel);

  if (opts.instant) {
    const release = () => b.classList.remove("is-pressed");
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (b.disabled) return;
      b.classList.add("is-pressed");
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
      onPress();
    });
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("lostpointercapture", release);
  } else {
    b.addEventListener("click", (e) => {
      if (b.disabled) return;
      // Drop focus after a pointer click so Space/Enter don't re-trigger it.
      if (e.detail > 0) b.blur();
      onPress();
    });
  }
  return b;
}

function holdButton(
  label: string,
  className: string,
  onStart: () => void,
  onEnd: () => void,
  title: string,
): HTMLButtonElement {
  const b = button(label, className, onStart, { instant: true, title });
  const release = () => {
    b.classList.remove("is-pressed");
    onEnd();
  };
  b.addEventListener("pointerup", release);
  b.addEventListener("pointercancel", release);
  b.addEventListener("lostpointercapture", release);
  return b;
}

interface Bar {
  root: HTMLElement;
  set(hp: number, max: number): void;
}

function makeBar(className: string): Bar {
  const root = el("div", `bar ${className}`);
  const fill = el("div", "bar__fill");
  root.append(fill);
  const setWidth = styleCell(fill, "width");
  let lastTone = "";
  return {
    root,
    set(hp, max) {
      const ratio = max > 0 ? Math.min(1, Math.max(0, hp / max)) : 0;
      setWidth(`${Math.round(ratio * 200) / 2}%`);
      const tone = ratio > 0.6 ? "ok" : ratio > 0.3 ? "warn" : "bad";
      if (tone !== lastTone) {
        lastTone = tone;
        root.dataset.tone = tone;
      }
    },
  };
}

interface Stat {
  root: HTMLElement;
  set(value: string): void;
}

function makeStat(label: string, className: string): Stat {
  const root = el("div", `stat ${className}`);
  const value = el("span", "stat__value");
  root.append(el("span", "stat__label", label), value);
  return { root, set: textCell(value) };
}

function statItem(label: string, value: string): HTMLElement {
  const item = el("div", "stats__item");
  item.append(el("div", "stats__label", label), el("div", "stats__value", value));
  return item;
}

function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

function fmtGold(value: number): string {
  return `${GOLD} ${Math.floor(value)}`;
}

function trainBuffSummary(train: Train): string {
  const b = train.buffs;
  const parts = [
    `+${Math.round((b.hpMult - 1) * 100)}% max HP`,
    `${Math.round(b.armor * 100)}% damage reduction`,
    `${b.heal.toFixed(1)} HP/s repair`,
  ];
  if (b.guardRate > 0) parts.push(`cattle guard every ${b.guardTime.toFixed(1)}s`);
  return `Train buffs: ${parts.join(" · ")}`;
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

export function mountUi(root: HTMLElement, game: GameApi): UiHandle {
  root.replaceChildren();
  root.classList.add("ui");
  root.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------- A. Top HUD ---------- */

  const hud = el("div", "hud");
  const hudMain = el("div", "hud__row hud__row--main");
  const waveStat = makeStat("WAVE", "stat--wave");
  const goldStat = makeStat("GOLD", "stat--gold");

  const engine = el("div", "engine");
  const engineBar = makeBar("bar--engine");
  const engineHp = el("span", "engine__hp");
  engine.append(el("span", "engine__label", "ENGINE"), engineBar.root, engineHp);
  const setEngineHp = textCell(engineHp);

  hudMain.append(waveStat.root, engine, goldStat.root);

  const hudSub = el("div", "hud__row hud__row--sub");
  const enemiesStat = makeStat("ENEMIES", "stat--enemies");
  const timeStat = makeStat("TIME", "stat--time");
  const carsStat = makeStat("CARS", "stat--cars");
  const guardStat = makeStat("GUARD", "stat--guard");
  const setGuardShown = classCell(guardStat.root, "is-hidden");
  const setGuardReady = classCell(guardStat.root, "is-ready");
  hudSub.append(enemiesStat.root, timeStat.root, carsStat.root, guardStat.root);

  hud.append(hudMain, hudSub);

  /* ---------- B. Wave banner + toast ---------- */

  const center = el("div", "center");
  const banner = el("div", "banner");
  const bannerText = el("div", "banner__text");
  banner.append(bannerText, el("div", "banner__sub", "INCOMING"));
  const toast = el("div", "toast");
  center.append(banner, toast);

  const setBannerOn = classCell(banner, "is-on");
  const setBannerText = textCell(bannerText);
  const setBannerOpacity = styleCell(banner, "opacity");
  const setToastOn = classCell(toast, "is-on");
  const setToastText = textCell(toast);
  const setToastOpacity = styleCell(toast, "opacity");

  /* ---------- C. Control dock ---------- */

  const dock = el("div", "dock");

  const dockTop = el("div", "dock__top");
  const shopBtn = button("SHOP (B)", "btn--sm dock__aux", () => game.openShop(), {
    instant: true,
    title: "Open the Depot (B)",
  });
  const steer = el("div", "steer");
  steer.setAttribute("aria-label", "Continuous steering");
  steer.title = "Hold LEFT or RIGHT to steer";
  const steerTrack = el("span", "steer__track");
  const steerIndicator = el("span", "steer__indicator");
  steerTrack.append(steerIndicator);
  steer.append(steerTrack);
  const pauseBtn = button("PAUSE (P)", "btn--sm dock__aux", () => game.togglePause(), {
    instant: true,
    title: "Pause (P)",
  });
  dockTop.append(shopBtn, steer, pauseBtn);

  const dockRow = el("div", "dock__row");
  const leftBtn = holdButton(
    "◀ LEFT",
    "ctl ctl--steer",
    () => game.setSteer(-1),
    () => game.setSteer(0),
    "Hold to steer left (A / ←)",
  );
  const speedControl = el("label", "ctl ctl--speed");
  speedControl.title = "Drag to set speed; W / S also adjust it";
  const speedHead = el("span", "speed__head");
  const speedState = el("span", "ctl__state");
  speedHead.append(el("span", "ctl__cap", "SPEED"), speedState);
  const speedSlider = el("input", "speed__slider");
  speedSlider.type = "range";
  speedSlider.min = "0";
  speedSlider.max = "100";
  speedSlider.step = "1";
  speedSlider.setAttribute("aria-label", "Speed");
  speedSlider.addEventListener("input", () => game.setThrottle(Number(speedSlider.value) / 100));
  speedControl.append(speedHead, speedSlider);
  const rightBtn = holdButton(
    "RIGHT ▶",
    "ctl ctl--steer",
    () => game.setSteer(1),
    () => game.setSteer(0),
    "Hold to steer right (D / →)",
  );
  dockRow.append(leftBtn, speedControl, rightBtn);

  dock.append(dockTop, dockRow);

  let lastThrottle = -1;
  const setSpeedLabel = textCell(speedState);

  /* ---------- D. Ready overlay ---------- */

  const ready = el("div", "overlay overlay--ready");
  ready.setAttribute("role", "dialog");
  ready.setAttribute("aria-label", "Start");
  const readyPanel = el("div", "panel");

  const howTo = el("ol", "howto");
  const steps = [
    "Hold LEFT or RIGHT for smooth steering. Drag SPEED to set any speed.",
    "Enemy trains arrive in waves and get tougher. Every enemy car you destroy pays gold.",
    "When a car dies, every car coupled behind it derails, unless a Re-Coupler sits right behind it. Lose your front engine and the run is over.",
    "Your turrets aim at the frontmost enemy car they can reach. Wreck a locomotive and its whole train derails, leaving a crate that adds a car to yours.",
    "SHOP (B) opens the Depot: buy, sell, upgrade and reorder cars. Time stops while it is open.",
  ];
  steps.forEach((text, i) => {
    const li = el("li");
    li.append(el("span", "howto__n", String(i + 1)), el("span", "howto__text", text));
    howTo.append(li);
  });

  const bestLine = el("p", "best");
  const setBestLine = textCell(bestLine);

  const readyActions = el("div", "actions");
  const startBtn = button("START", "btn--accent btn--big", () => game.start());
  readyActions.append(startBtn);

  const keysHint = el(
    "p",
    "hint",
    "Hold A / D or ← → to steer · W / ↑ faster · S / ↓ slower · Space stop/full · B shop · P or Esc pause",
  );

  readyPanel.append(
    el("div", "brand", "RAILGUN"),
    el("p", "tagline", "Steer. Survive. Couple up."),
    el("h2", "panel__heading", "How it works"),
    howTo,
    bestLine,
    readyActions,
    keysHint,
  );
  ready.append(readyPanel);

  /* ---------- E. Pause overlay ---------- */

  const pause = el("div", "overlay overlay--pause");
  pause.setAttribute("role", "dialog");
  pause.setAttribute("aria-label", "Paused");
  const pausePanel = el("div", "panel panel--narrow");
  const pauseActions = el("div", "actions");
  pauseActions.append(
    button("Resume", "btn--accent btn--big", () => game.resume()),
    button("Shop", "", () => game.openShop()),
    button("Restart", "btn--danger", () => game.restart(), {
      title: "Abandon this run and return to the title screen",
    }),
  );
  pausePanel.append(
    el("h1", "panel__title", "PAUSED"),
    el("p", "panel__sub", "The rails are waiting."),
    pauseActions,
    el("p", "hint", "P or Esc to resume"),
  );
  pause.append(pausePanel);

  /* ---------- F. Death screen ---------- */

  const dead = el("div", "overlay overlay--dead");
  dead.setAttribute("role", "dialog");
  dead.setAttribute("aria-label", "Run over");
  const deadPanel = el("div", "panel");
  const deadSub = el("p", "panel__sub");
  const setDeadSub = textCell(deadSub);
  const bestBadge = el("div", "badge", "New best!");
  const badgeWrap = el("div", "badge-wrap");
  badgeWrap.append(bestBadge);
  const statsGrid = el("div", "stats");
  const deadActions = el("div", "actions");
  deadActions.append(
    button("Play again", "btn--accent btn--big", () => {
      game.restart();
      game.start();
    }),
    button("RESTART", "", () => game.restart(), {
      title: "Return to the title screen",
    }),
  );
  deadPanel.append(
    el("h1", "panel__title", "DERAILED"),
    deadSub,
    badgeWrap,
    statsGrid,
    deadActions,
    el("p", "hint", "Enter to play again"),
  );
  dead.append(deadPanel);

  /* ---------- G. Shop ---------- */

  const shop = el("div", "overlay shop");
  shop.setAttribute("role", "dialog");
  shop.setAttribute("aria-label", "Depot");
  const shopPanel = el("div", "panel shop__panel");

  const shopHead = el("header", "shop__head");
  const shopGold = el("div", "shop__gold");
  const setShopGold = textCell(shopGold);
  shopHead.append(
    el("h1", "shop__title", "DEPOT"),
    shopGold,
    button("✕", "btn--icon btn--ghost", () => game.closeShop(), {
      ariaLabel: "Close the Depot",
      title: "Close (B / Esc)",
    }),
  );

  const shopBody = el("div", "shop__body");

  const trainSection = el("section", "section");
  const trainHead = el("div", "section__head");
  const trainCount = el("span", "section__meta");
  const setTrainCount = textCell(trainCount);
  trainHead.append(el("h2", "section__title", "YOUR TRAIN"), trainCount);
  const trainList = el("ol", "train");
  const buffLine = el("p", "section__hint section__hint--buffs");
  const setBuffLine = textCell(buffLine);
  trainSection.append(
    trainHead,
    el(
      "p",
      "section__hint",
      "Front to back. A destroyed car derails every car behind it, so keep what you cannot afford to lose near the front. A Re-Coupler right behind a car saves everything behind it if that car dies.",
    ),
    buffLine,
    trainList,
  );

  const buySection = el("section", "section");
  const buyHead = el("div", "section__head");
  buyHead.append(el("h2", "section__title", "BUY CARS"));
  const fullHint = el("p", "section__hint section__hint--warn", "Train full. Sell a car to make room.");
  const buyGrid = el("div", "buy-grid");
  buySection.append(
    buyHead,
    el("p", "section__hint", "New cars couple to the back of your train."),
    fullHint,
    buyGrid,
  );

  shopBody.append(buySection, trainSection);

  const shopFoot = el("footer", "shop__foot");
  shopFoot.append(button("Back to the rails", "btn--accent btn--big", () => game.closeShop()));

  shopPanel.append(shopHead, shopBody, shopFoot);
  shop.append(shopPanel);
  shop.addEventListener("click", (e) => {
    if (e.target === shop) game.closeShop();
  });

  function carRow(car: Car, index: number, count: number): HTMLElement {
    const def = CAR_DEFS[car.kind];
    const isLoco = index === 0;
    const row = el("li", isLoco ? "car car--loco" : "car");
    row.style.setProperty("--car-color", def.color);
    row.style.setProperty("--car-accent", def.accent);

    const idx = el("div", "car__index", isLoco ? "LOCO" : String(index + 1));
    const swatch = el("div", "car__swatch", def.glyph);
    swatch.setAttribute("aria-hidden", "true");

    const info = el("div", "car__info");
    const nameRow = el("div", "car__name");
    nameRow.append(el("span", "car__title", def.name), el("span", "tag", `Lv ${car.level}`));
    if (isLoco) nameRow.append(el("span", "tag tag--loco", "Locomotive"));
    const bar = makeBar("bar--sm");
    bar.set(car.hp, car.maxHp);
    const hpLine = el("div", "car__hp");
    hpLine.append(bar.root, el("span", "car__hptext", `${Math.ceil(car.hp)} / ${car.maxHp} HP`));
    info.append(nameRow, hpLine);

    const actions = el("div", "car__actions");

    const up = button(
      "↑",
      "btn--icon",
      () => {
        game.moveCar(index, -1);
        renderShop();
      },
      { ariaLabel: "Move forward", title: "Move forward" },
    );
    up.disabled = index <= 1;
    const down = button(
      "↓",
      "btn--icon",
      () => {
        game.moveCar(index, 1);
        renderShop();
      },
      { ariaLabel: "Move back", title: "Move back" },
    );
    down.disabled = isLoco || index >= count - 1;
    if (isLoco) {
      up.classList.add("is-ghost");
      down.classList.add("is-ghost");
    }

    const atMax = car.level >= def.maxLevel;
    const upgrade = button(
      atMax ? "MAX" : `Upgrade ${GOLD}${game.upgradeCost(car)}`,
      "btn--sm btn--accent",
      () => {
        game.upgradeCar(index);
        renderShop();
      },
      { title: atMax ? "Already at maximum level" : `Upgrade to level ${car.level + 1}` },
    );
    upgrade.disabled = atMax || !game.canUpgrade(car);

    const sell = button(
      `Sell +${GOLD}${game.sellValue(car)}`,
      "btn--sm",
      () => {
        game.sellCar(index);
        renderShop();
      },
      { title: isLoco ? "The locomotive cannot be sold" : "Sell this car" },
    );
    sell.disabled = !game.canSell(index);

    actions.append(up, down, upgrade, sell);
    row.append(idx, swatch, info, actions);
    return row;
  }

  function buyCard(kind: CarKind, full: boolean, gold: number): HTMLElement {
    const def = CAR_DEFS[kind];
    const cost = game.carCost(kind);
    const card = el("div", "buy");
    card.style.setProperty("--car-color", def.color);
    card.style.setProperty("--car-accent", def.accent);
    card.classList.toggle("is-unaffordable", gold < cost);

    const head = el("div", "buy__head");
    const swatch = el("div", "buy__swatch", def.glyph);
    swatch.setAttribute("aria-hidden", "true");
    const titles = el("div", "buy__titles");
    titles.append(
      el("div", "buy__name", def.name),
      el("div", "buy__meta", `HP ${def.baseHp} · Max Lv ${def.maxLevel}`),
    );
    head.append(swatch, titles);

    const buy = button(
      `Buy ${GOLD}${cost}`,
      "btn--sm btn--accent buy__btn",
      () => {
        game.buyCar(kind);
        renderShop();
      },
    );
    buy.disabled = !game.canBuy(kind);
    if (buy.disabled) {
      buy.title = full ? "Train is full" : gold < cost ? "Not enough gold" : "Unavailable";
    }

    card.append(head, el("p", "buy__desc", def.description), buy);
    return card;
  }

  function renderShop(): void {
    const snap = game.snap;
    const cars = snap.player.cars;
    const gold = Math.floor(snap.gold);
    const full = cars.length >= game.maxCars;

    setShopGold(fmtGold(gold));
    setTrainCount(`${cars.length} / ${game.maxCars} cars`);
    setBuffLine(trainBuffSummary(snap.player));
    trainList.replaceChildren(...cars.map((car, i) => carRow(car, i, cars.length)));
    fullHint.hidden = !full;
    buyGrid.replaceChildren(...CAR_KINDS.map((kind) => buyCard(kind, full, gold)));
  }

  /* ---------- Phase rendering ---------- */

  function renderReady(): void {
    const best = game.snap.best;
    const has = best.wave > 0;
    bestLine.hidden = !has;
    if (has) setBestLine(`Best: wave ${best.wave} · ${fmtTime(best.time)}`);
  }

  function renderDead(): void {
    const snap = game.snap;
    const { stats, best } = snap;
    setDeadSub(`Your locomotive was destroyed on wave ${snap.wave}.`);
    const isBest = best.wave > 0 && snap.wave >= best.wave && snap.time >= best.time - 0.01;
    badgeWrap.hidden = !isBest;
    statsGrid.replaceChildren(
      statItem("Wave reached", String(snap.wave)),
      statItem("Time survived", fmtTime(snap.time)),
      statItem("Gold earned", fmtGold(stats.goldEarned)),
      statItem("Kills", String(stats.kills)),
      statItem("Trains destroyed", String(stats.trainsDestroyed)),
      statItem("Cars lost", String(stats.carsLost)),
      statItem("Cars captured", String(stats.carsCaptured)),
    );
  }

  let lastPhase: Phase | null = null;

  function render(): void {
    const phase = game.snap.phase;
    const changed = phase !== lastPhase;
    if (changed) {
      lastPhase = phase;
      root.dataset.phase = phase;
      hud.hidden = phase === "ready";
      dock.hidden = phase === "ready" || phase === "dead";
      ready.hidden = phase !== "ready";
      pause.hidden = phase !== "paused";
      dead.hidden = phase !== "dead";
      shop.hidden = phase !== "shop";
      if (phase === "shop") shopBody.scrollTop = 0;
    }
    if (phase === "ready") renderReady();
    else if (phase === "dead") renderDead();
    else if (phase === "shop") renderShop();
  }

  /* ---------- Mount ---------- */
  // Keyboard bindings live in src/input.ts (wired by main.ts); binding them
  // here as well would dispatch every key twice.

  root.append(hud, center, dock, ready, pause, dead, shop);
  game.onChange(render);
  render();

  /* ---------- Per-frame ---------- */

  const bannerTotal = WAVES.bannerTime > 0 ? WAVES.bannerTime : 1;

  function tick(_dt: number): void {
    const snap = game.snap;
    if (snap.phase !== lastPhase) render();

    const player = snap.player;
    const cars = player.cars;

    waveStat.set(String(snap.wave));
    goldStat.set(fmtGold(snap.gold));
    enemiesStat.set(
      `${snap.enemiesAlive} ${snap.enemiesAlive === 1 ? "train" : "trains"} · ${snap.enemyCarsAlive} ${
        snap.enemyCarsAlive === 1 ? "car" : "cars"
      }`,
    );
    timeStat.set(fmtTime(snap.time));
    carsStat.set(`${cars.length} / ${game.maxCars}`);
    const hasGuard = player.buffs.guardRate > 0;
    setGuardShown(!hasGuard);
    if (hasGuard) {
      const ready = player.guardCharge >= 1;
      setGuardReady(ready);
      guardStat.set(ready ? "READY" : `${Math.floor(player.guardCharge * 100)}%`);
    }

    const loco = cars[0];
    if (loco) {
      engineBar.set(loco.hp, loco.maxHp);
      setEngineHp(`${Math.max(0, Math.ceil(loco.hp))} / ${loco.maxHp}`);
    } else {
      engineBar.set(0, 1);
      setEngineHp("—");
    }

    const bannerOn = snap.waveBanner > 0;
    setBannerOn(bannerOn);
    if (bannerOn) {
      setBannerText(`WAVE ${snap.wave}`);
      const elapsed = bannerTotal - snap.waveBanner;
      const alpha = Math.min(1, Math.max(0, elapsed / 0.2), Math.max(0, snap.waveBanner / 0.6));
      setBannerOpacity(alpha.toFixed(2));
    }

    const toastOn = snap.toastTimer > 0 && snap.toast !== "";
    setToastOn(toastOn);
    if (toastOn) {
      setToastText(snap.toast);
      setToastOpacity(Math.min(1, snap.toastTimer / 0.35).toFixed(2));
    }

    steerIndicator.style.setProperty("--steer", player.steer.toFixed(3));

    if (player.throttle !== lastThrottle) {
      lastThrottle = player.throttle;
      const percent = Math.round(player.throttle * 100);
      speedSlider.value = String(percent);
      setSpeedLabel(`${percent}%`);
    }
  }

  return { tick };
}
