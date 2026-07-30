import Phaser from "phaser";
import { Rng } from "../agent/rng";
import { readAgentConfig, type AgentConfig } from "../agent/config";
import { getEventBus } from "../agent/events";
import { GameHud } from "../ui/GameHud";
import { TUNING, DRAG } from "../sim/constants";
import { createSatellite, type Satellite } from "../sim/Satellite";
import { createDebris, type Debris, type DebrisSource } from "../sim/Debris";
import {
  TWO_PI,
  advanceAngle,
  angleDelta,
  ascentPoint,
  burnoutState,
  circularSpeed,
  circularStep,
  isAngleCovered,
  normalizeAngle,
  orbitalElements,
  pointOnCircle,
  predictPath,
  stepBody,
  type BodyState,
} from "../core/orbit";
import { accrueRevenue, canAfford, isBankrupt, spend, type Wallet } from "../core/economy";
import { BANDS, bandFor, footprintHalfWidthFor, rateMultiplier } from "../sim/bands";
import { SITES, siteById, sitesUnlockedFor, type SiteDef } from "../sim/sites";

const COL = {
  earth: 0x17457f,
  earthLand: 0x2e7d5b,
  atmosphere: 0x4a90d9,
  healthy: 0x3dd6a0,
  warn: 0xef9f27,
  danger: 0xe24b4a,
  covered: 0x97c459,
  gap: 0xe24b4a,
  rocket: 0xe6ecf5,
  select: 0xffffff,
  debris: 0xd85a30,
  flash: 0xffd27a,
  pad: 0xe6ecf5,
  guide: 0x2b3a56,
} as const;

const FONT = "ui-monospace, monospace";

export class GameScene extends Phaser.Scene {
  private cfg!: AgentConfig;
  private rng!: Rng;
  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: GameHud;

  private cx = TUNING.surface / 2;
  private cy = TUNING.surface / 2;

  private sats: Satellite[] = [];
  private debris: Debris[] = [];
  private nextId = 1;
  private selectedId: number | null = null;

  private wallet: Wallet = { cash: TUNING.startingCash, valuation: 0 };
  private regionAngle = 0; // contract region's ground angle (rotates with Earth)
  private earthSpin = 0;
  private covered = false;
  private coverageLinger = 0;
  // Band rate multiplier of whoever is currently serving the region.
  private coverageRateMult = 1;
  private landmasses: { angle: number; dist: number; pts: { x: number; y: number }[] }[] = [];

  // Launch console state. fpaDeg 0 = tangential/ideal; power is the 0..1 dial
  // (clamped by the active site's maxPower).
  private consoleOpen = false;
  private fpaDeg = 0;
  private power = 0.3;
  private consoleText!: Phaser.GameObjects.Text;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // Progression: which sites valuation has unlocked, and which is active.
  private activeSiteId: string = SITES[0].id;
  private unlockedIds = new Set<string>([SITES[0].id]);

  private paused = false;
  private gameOver = false;
  private gameOverReason: "bankruptcy" | "kessler" | null = null;
  private gameOverBound = false;

  private revenueAccum = 0;
  private lastFrameEmit = 0;
  private ambientTimer = 0;
  private ambientNextGap: number = TUNING.ambientFirstSec;
  private flashes: { x: number; y: number; ttl: number }[] = [];

  constructor() {
    super("game");
  }

  create(): void {
    this.cfg = readAgentConfig();
    this.rng = new Rng(this.cfg.seed);
    const bus = getEventBus();

    this.sats = [];
    this.debris = [];
    this.flashes = [];
    this.nextId = 1;
    this.selectedId = null;
    this.wallet = { cash: TUNING.startingCash, valuation: 0 };
    this.regionAngle = this.rng.range(0, TWO_PI);
    this.earthSpin = 0;
    this.covered = false;
    this.coverageLinger = 0;
    this.coverageRateMult = 1;
    this.consoleOpen = false;
    this.fpaDeg = 0;
    this.power = 0.3;
    this.activeSiteId = SITES[0].id;
    this.unlockedIds = new Set(sitesUnlockedFor(0).map((s) => s.id));
    this.paused = this.cfg.paused;
    this.gameOver = false;
    this.gameOverReason = null;
    this.gameOverBound = false;
    this.revenueAccum = 0;
    this.ambientTimer = 0;
    this.ambientNextGap = TUNING.ambientFirstSec;
    this.buildLandmasses();

    this.gfx = this.add.graphics();
    this.hud = new GameHud(this);
    this.consoleText = this.add
      .text(this.cx, TUNING.surface - 74, "", {
        fontFamily: FONT,
        fontSize: "14px",
        color: "#e6ecf5",
      })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setVisible(false);

    this.bindInput();

    bus.bindInput({
      launch: (fpaDeg, power) => this.doLaunch(fpaDeg, power),
      boost: (id) => this.doBoost(id),
      deorbit: (id) => this.doDeorbit(id),
      selectSite: (siteId) => this.doSelectSite(siteId),
      pause: () => this.togglePause(),
    });
    bus.bindCheats({
      addCash: (amount) => {
        this.wallet.cash += amount;
      },
      addValuation: (amount) => {
        this.wallet.valuation += amount;
        this.checkUnlocks();
      },
      spawnSat: (angle, radius, vFactor = 1) => this.cheatSpawnSat(angle, radius, vFactor),
      spawnDebris: (angle, radius, vFactor = 1) =>
        this.spawnDebrisBody(
          angle ?? this.rng.range(0, TWO_PI),
          radius ?? this.rng.range(TUNING.ambientRadiusMin, TUNING.ambientRadiusMax),
          vFactor,
          "cheat",
        ),
    });

    bus.emit({ type: "scene", t: 0, name: "game" });
    bus.emit({ type: "run-start", t: 0, seed: this.cfg.seed });
    this.pushSnapshot();
  }

  private bindInput(): void {
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    kb.on("keydown-SPACE", () => this.togglePause());
    kb.on("keydown-B", () => this.doBoost());
    kb.on("keydown-D", () => this.doDeorbit());
    kb.on("keydown-L", () => this.toggleConsole());
    kb.on("keydown-ESC", () => this.closeConsole());
    kb.on("keydown-ENTER", () => {
      if (this.consoleOpen) this.doLaunch(this.fpaDeg, this.power);
    });
    // Number keys pick a launch site; TAB cycles the unlocked ones.
    SITES.forEach((site, i) => {
      kb.on(`keydown-${["ONE", "TWO", "THREE"][i] ?? `NUMPAD_${i + 1}`}`, () =>
        this.doSelectSite(site.id),
      );
    });
    kb.on("keydown-TAB", () => this.cycleSite());

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.gameOver) return;
      const hit = this.satNearScreen(p.x, p.y);
      if (hit) {
        this.selectedId = hit.id;
        this.hud.toast(`sat #${hit.id} selected — B to boost, D to de-orbit`);
      } else {
        this.selectedId = null;
      }
    });
  }

  // ----- launch console -----

  private toggleConsole(): void {
    if (this.gameOver) return;
    this.consoleOpen = !this.consoleOpen;
    this.consoleText.setVisible(this.consoleOpen);
  }

  private closeConsole(): void {
    this.consoleOpen = false;
    this.consoleText.setVisible(false);
  }

  private activeSite(): SiteDef {
    return siteById(this.activeSiteId) ?? SITES[0];
  }

  // Pads are fixed in the Earth frame, so they rotate with the planet.
  private siteScreenAngle(site: SiteDef = this.activeSite()): number {
    return normalizeAngle(this.earthSpin + site.angle);
  }

  private consoleBurnout(): BodyState {
    const L = TUNING.launch;
    const speed = L.minSpeed + this.power * (L.maxSpeed - L.minSpeed);
    return burnoutState(
      this.siteScreenAngle(),
      L.downrangeRad,
      L.burnoutRadius,
      speed,
      (this.fpaDeg * Math.PI) / 180,
      TUNING.earthOmega,
    );
  }

  // Switch pads. Better sites lift the power ceiling — that's the progression.
  private doSelectSite(siteId: string): void {
    if (this.gameOver) return;
    const site = siteById(siteId);
    if (!site) {
      this.blocked("select-site", "unknown", `no such launch site`);
      return;
    }
    if (!this.unlockedIds.has(site.id)) {
      this.blocked(
        "select-site",
        "locked",
        `${site.name} locked — needs $${site.unlockValuation} valuation`,
      );
      return;
    }
    this.activeSiteId = site.id;
    this.power = Math.min(this.power, site.maxPower);
    this.hud.toast(`launching from ${site.name}`);
    this.pushSnapshot();
  }

  // The next site valuation hasn't bought yet — the progression carrot.
  private nextUnlock(): { name: string; at: number } | null {
    const locked = SITES.filter((s) => !this.unlockedIds.has(s.id));
    if (!locked.length) return null;
    const next = locked.reduce((a, b) => (a.unlockValuation <= b.unlockValuation ? a : b));
    return { name: next.name, at: next.unlockValuation };
  }

  private cycleSite(): void {
    const open = SITES.filter((s) => this.unlockedIds.has(s.id));
    if (open.length < 2) return;
    const idx = open.findIndex((s) => s.id === this.activeSiteId);
    this.doSelectSite(open[(idx + 1) % open.length].id);
  }

  // Valuation is the unlock currency: crossing a site's threshold opens it.
  private checkUnlocks(): void {
    for (const site of sitesUnlockedFor(this.wallet.valuation)) {
      if (this.unlockedIds.has(site.id)) continue;
      this.unlockedIds.add(site.id);
      getEventBus().emit({ type: "site-unlocked", t: 0, siteId: site.id });
      this.hud.toast(`${site.name} unlocked — press ${SITES.indexOf(site) + 1} to use it`);
    }
  }

  // ----- actions -----

  private doLaunch(fpaDeg: number, power: number): void {
    if (this.gameOver) return;
    if (this.sats.length >= TUNING.maxSatellites) {
      this.blocked("launch", "max-sats", `fleet full — ${TUNING.maxSatellites} sats max`);
      return;
    }
    if (!canAfford(this.wallet.cash, TUNING.launchCost)) {
      this.blocked("launch", "cash", `launch costs $${TUNING.launchCost} — not enough cash`);
      return;
    }
    const L = TUNING.launch;
    const site = this.activeSite();
    const fpa = Phaser.Math.Clamp(fpaDeg, L.fpaMinDeg, L.fpaMaxDeg);
    // The site caps how hard you can throw — a basic pad can't reach GEO.
    const pow = Phaser.Math.Clamp(power, 0, site.maxPower);
    this.wallet.cash = spend(this.wallet.cash, TUNING.launchCost);

    const siteAngle = this.siteScreenAngle(site);
    const speed = L.minSpeed + pow * (L.maxSpeed - L.minSpeed);
    const burnout = burnoutState(
      siteAngle,
      L.downrangeRad,
      L.burnoutRadius,
      speed,
      (fpa * Math.PI) / 180,
      TUNING.earthOmega,
    );
    const pad = pointOnCircle(0, 0, TUNING.earthRadius, siteAngle);
    const sat = createSatellite(this.nextId++, burnout, pad.x, pad.y, L.ascentSeconds);
    this.sats.push(sat);
    getEventBus().emit({
      type: "launch",
      t: 0,
      id: sat.id,
      fpa,
      power: pow,
      cost: TUNING.launchCost,
    });
    this.pushSnapshot();
  }

  private doBoost(id?: number): void {
    if (this.gameOver) return;
    const target = this.pickTarget(id);
    if (!target) {
      this.blocked("boost", "no-target", "no satellite to boost");
      return;
    }
    if (!canAfford(this.wallet.cash, TUNING.boostCost)) {
      this.blocked("boost", "cash", `boost costs $${TUNING.boostCost} — not enough cash`);
      return;
    }
    // Raise the orbit one step, but never past the top of the current band —
    // climbing to a higher band is what better launch pads are for.
    const from = Math.hypot(target.x, target.y);
    const band = bandFor(from);
    const ceiling = Number.isFinite(band.max) ? band.max - TUNING.boostBandMargin : Infinity;
    if (from >= ceiling) {
      this.blocked(
        "boost",
        "at-ceiling",
        `sat #${target.id} is at the top of ${band.label} — launch higher from a better pad`,
      );
      return;
    }
    const to = Math.min(from + TUNING.boostRise, ceiling);
    this.wallet.cash = spend(this.wallet.cash, TUNING.boostCost);
    target.raiseFrom = from;
    target.raiseTo = to;
    target.raiseRemaining = TUNING.boostSeconds;
    getEventBus().emit({
      type: "boost",
      t: 0,
      id: target.id,
      fromRadius: from,
      toRadius: to,
      cost: TUNING.boostCost,
    });
    this.hud.toast(`sat #${target.id} raising to ${Math.round(to)} (${bandFor(to).label})`);
    this.pushSnapshot();
  }

  // Command a clean de-orbit: pay a small fee to remove a sat before it dies or
  // gets hit — the counter-play to Kessler, since it leaves no debris.
  private doDeorbit(id?: number): void {
    if (this.gameOver) return;
    const target = this.pickTarget(id);
    if (!target) {
      this.blocked("deorbit", "no-target", "no satellite to de-orbit");
      return;
    }
    if (!canAfford(this.wallet.cash, TUNING.deorbitCost)) {
      this.blocked("deorbit", "cash", `de-orbit costs $${TUNING.deorbitCost} — not enough cash`);
      return;
    }
    this.wallet.cash = spend(this.wallet.cash, TUNING.deorbitCost);
    this.sats = this.sats.filter((s) => s.id !== target.id);
    if (this.selectedId === target.id) this.selectedId = null;
    getEventBus().emit({ type: "deorbit", t: 0, id: target.id, reason: "commanded" });
    this.pushSnapshot();
  }

  // id → that sat; else selected; else the lowest-perigee live sat.
  private pickTarget(id?: number): Satellite | undefined {
    if (id != null) return this.sats.find((s) => s.id === id && s.live);
    if (this.selectedId != null) {
      const sel = this.sats.find((s) => s.id === this.selectedId && s.live);
      if (sel) return sel;
    }
    let best: Satellite | undefined;
    for (const s of this.sats) {
      if (!s.live) continue;
      if (!best || s.perigee < best.perigee) best = s;
    }
    return best;
  }

  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;
    getEventBus().updateSnapshot({ paused: this.paused });
  }

  private blocked(
    action: "launch" | "boost" | "deorbit" | "select-site",
    reason: "cash" | "max-sats" | "no-target" | "locked" | "unknown" | "at-ceiling",
    message: string,
  ): void {
    this.hud.toast(message);
    getEventBus().emit({ type: "action-blocked", t: 0, action, reason });
  }

  private buildLandmasses(): void {
    this.landmasses = [];
    for (let i = 0; i < 14 && this.landmasses.length < 4; i++) {
      const angle = this.rng.range(0, TWO_PI);
      const dist = this.rng.range(0, TUNING.earthRadius * 0.5);
      const maxR = Math.min(TUNING.earthRadius - 5 - dist, this.rng.range(11, 18));
      if (maxR < 7) continue;
      const verts = this.rng.int(8, 12);
      const pts: { x: number; y: number }[] = [];
      for (let v = 0; v < verts; v++) {
        const a = (v / verts) * TWO_PI;
        const r = maxR * this.rng.range(0.5, 1);
        pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
      }
      this.landmasses.push({ angle, dist, pts });
    }
  }

  private cheatSpawnSat(angle: number, radius: number, vFactor: number): void {
    if (this.sats.length >= TUNING.maxSatellites) return;
    const state = this.onOrbitState(angle, radius, vFactor);
    const sat = createSatellite(this.nextId++, state, state.x, state.y, 0);
    const el = orbitalElements(TUNING.mu, sat);
    sat.perigee = el.perigee;
    sat.apogee = el.apogee;
    sat.live = el.perigee >= TUNING.insertFloor && el.e < 1;
    this.sats.push(sat);
    this.pushSnapshot();
  }

  private onOrbitState(angle: number, radius: number, vFactor: number): BodyState {
    const v = circularSpeed(TUNING.mu, radius) * vFactor;
    const p = pointOnCircle(0, 0, radius, angle);
    return { x: p.x, y: p.y, vx: -Math.sin(angle) * v, vy: Math.cos(angle) * v };
  }

  private spawnDebrisBody(
    angle: number,
    radius: number,
    vFactor: number,
    source: DebrisSource,
  ): void {
    if (this.debris.length >= TUNING.maxDebris) return;
    const d = createDebris(this.nextId++, this.onOrbitState(angle, radius, vFactor), source);
    this.debris.push(d);
    getEventBus().emit({
      type: "debris-spawn",
      t: 0,
      id: d.id,
      angle: normalizeAngle(angle),
      source,
    });
  }

  private endGame(reason: "bankruptcy" | "kessler"): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameOverReason = reason;
    this.closeConsole();
    const bus = getEventBus();
    if (reason === "bankruptcy") {
      this.wallet.cash = 0;
      bus.emit({ type: "bankruptcy", t: 0, valuation: this.wallet.valuation });
    } else {
      bus.emit({ type: "kessler-cascade", t: 0, debris: this.debris.length });
    }
    bus.emit({ type: "game-over", t: 0, reason, valuation: this.wallet.valuation });
  }

  // ----- loop -----

  update(_time: number, delta: number): void {
    const rawDt = Math.min(delta, 100) / 1000;
    if (!this.gameOver && !this.paused) {
      this.step(rawDt * this.cfg.timeScale);
    }
    // The console stays interactive even while paused — that's the strategy
    // layer: freeze time, plan the burn, fire.
    if (this.consoleOpen && !this.gameOver) this.updateConsole(rawDt);
    this.render();
    this.emitFrame();

    if (this.gameOver && !this.gameOverBound) {
      this.bindRestart();
    }
  }

  private updateConsole(dt: number): void {
    const L = TUNING.launch;
    if (this.cursors.left.isDown) this.fpaDeg -= 30 * dt;
    if (this.cursors.right.isDown) this.fpaDeg += 30 * dt;
    if (this.cursors.up.isDown) this.power += 0.35 * dt;
    if (this.cursors.down.isDown) this.power -= 0.35 * dt;
    this.fpaDeg = Phaser.Math.Clamp(this.fpaDeg, L.fpaMinDeg, L.fpaMaxDeg);
    this.power = Phaser.Math.Clamp(this.power, 0, this.activeSite().maxPower);
  }

  private step(dt: number): void {
    const bus = getEventBus();
    this.regionAngle = advanceAngle(this.regionAngle, TUNING.earthOmega, dt);
    this.earthSpin = advanceAngle(this.earthSpin, TUNING.earthOmega, dt);

    // Ambient external junk arrives on a seeded schedule into the low band.
    if (this.cfg.debris) {
      this.ambientTimer += dt;
      if (this.ambientTimer >= this.ambientNextGap) {
        this.ambientTimer = 0;
        this.ambientNextGap = this.rng.range(TUNING.ambientMinGapSec, TUNING.ambientMaxGapSec);
        this.spawnDebrisBody(
          this.rng.range(0, TWO_PI),
          this.rng.range(TUNING.ambientRadiusMin, TUNING.ambientRadiusMax),
          1 + this.rng.range(-TUNING.ambientSpeedJitter, TUNING.ambientSpeedJitter),
          "ambient",
        );
      }
    }

    // Satellites: ride the ascent animation, then live Newtonian flight.
    const deadSats: { id: number; reason: "decay" | "crash" | "escaped" }[] = [];
    for (const s of this.sats) {
      if (s.ascentRemaining > 0) {
        s.ascentRemaining -= dt;
        if (s.ascentRemaining > 0) continue;
        s.ascentRemaining = 0;
        // Burnout: the stored state becomes real. Stable orbit → live.
        const el = orbitalElements(TUNING.mu, s);
        s.perigee = el.perigee;
        s.apogee = el.apogee;
        if (el.perigee >= TUNING.insertFloor && el.e < 1) {
          s.live = true;
          bus.emit({ type: "insert", t: 0, id: s.id, perigee: el.perigee, apogee: el.apogee });
        }
        continue;
      }
      if (s.raiseRemaining > 0) {
        // On rails: glide up to the target circular orbit, ignoring drag.
        s.raiseRemaining = Math.max(0, s.raiseRemaining - dt);
        const progress = 1 - s.raiseRemaining / TUNING.boostSeconds;
        const targetR = s.raiseFrom + (s.raiseTo - s.raiseFrom) * progress;
        Object.assign(s, circularStep(s, TUNING.mu, targetR, dt));
        const rel = orbitalElements(TUNING.mu, s);
        s.perigee = rel.perigee;
        s.apogee = rel.apogee;
        if (rel.perigee >= TUNING.criticalPerigee) s.critical = false;
        continue;
      }
      stepBody(TUNING.mu, s, dt, DRAG);
      const r = Math.hypot(s.x, s.y);
      const el = orbitalElements(TUNING.mu, s);
      s.perigee = el.perigee;
      s.apogee = el.apogee;
      if (r <= TUNING.earthRadius + 2) {
        deadSats.push({ id: s.id, reason: s.live ? "decay" : "crash" });
      } else if (r > TUNING.escapeRadius) {
        deadSats.push({ id: s.id, reason: "escaped" });
      } else if (s.live && el.perigee < TUNING.criticalPerigee && !s.critical) {
        s.critical = true;
        bus.emit({ type: "decay-critical", t: 0, id: s.id, perigee: el.perigee });
      }
    }
    for (const d of deadSats) {
      bus.emit({ type: "deorbit", t: 0, id: d.id, reason: d.reason });
    }

    // Debris: same physics; burns up or leaves.
    const deadDebris: number[] = [];
    for (const d of this.debris) {
      stepBody(TUNING.mu, d, dt, DRAG);
      const r = Math.hypot(d.x, d.y);
      if (r <= TUNING.earthRadius + 2 || r > TUNING.escapeRadius) {
        deadDebris.push(d.id);
        bus.emit({ type: "debris-decay", t: 0, id: d.id });
      }
    }

    // Collisions: proximity in the plane. A hit shatters both into fragments —
    // the multiplier that turns junk into a cascade.
    const deadIds = new Set(deadSats.map((d) => d.id));
    const fragments: BodyState[] = [];
    for (const s of this.sats) {
      if (s.ascentRemaining > 0 || deadIds.has(s.id)) continue;
      for (const d of this.debris) {
        if (deadDebris.includes(d.id)) continue;
        const dx = s.x - d.x;
        const dy = s.y - d.y;
        if (dx * dx + dy * dy > TUNING.collisionDist * TUNING.collisionDist) continue;
        deadIds.add(s.id);
        deadSats.push({ id: s.id, reason: "decay" }); // marker; event emitted below
        deadDebris.push(d.id);
        bus.emit({
          type: "collision",
          t: 0,
          satId: s.id,
          debrisId: d.id,
          angle: normalizeAngle(Math.atan2(s.y, s.x)),
        });
        bus.emit({ type: "deorbit", t: 0, id: s.id, reason: "collision" });
        this.flashes.push({ x: s.x, y: s.y, ttl: 0.4 });
        for (let i = 0; i < TUNING.fragmentsPerCollision; i++) {
          fragments.push({
            x: (s.x + d.x) / 2,
            y: (s.y + d.y) / 2,
            vx: (s.vx + d.vx) / 2 + this.rng.range(-1, 1) * TUNING.fragmentSpeedJitter,
            vy: (s.vy + d.vy) / 2 + this.rng.range(-1, 1) * TUNING.fragmentSpeedJitter,
          });
        }
        break;
      }
    }

    // Debris striking debris. This is what lets a cascade feed itself: each
    // impact consumes two pieces and throws off more, so a crowded band can
    // run away on its own even after every satellite is gone.
    for (let i = 0; i < this.debris.length; i++) {
      const a = this.debris[i];
      if (deadDebris.includes(a.id)) continue;
      for (let j = i + 1; j < this.debris.length; j++) {
        const b = this.debris[j];
        if (deadDebris.includes(b.id)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy > TUNING.collisionDist * TUNING.collisionDist) continue;
        deadDebris.push(a.id, b.id);
        bus.emit({ type: "debris-collision", t: 0, aId: a.id, bId: b.id });
        this.flashes.push({ x: a.x, y: a.y, ttl: 0.3 });
        for (let k = 0; k < TUNING.fragmentsPerDebrisCollision; k++) {
          fragments.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            vx: (a.vx + b.vx) / 2 + this.rng.range(-1, 1) * TUNING.fragmentSpeedJitter,
            vy: (a.vy + b.vy) / 2 + this.rng.range(-1, 1) * TUNING.fragmentSpeedJitter,
          });
        }
        break;
      }
    }

    if (deadIds.size || deadSats.length) {
      const gone = new Set(deadSats.map((d) => d.id));
      this.sats = this.sats.filter((s) => !gone.has(s.id));
      if (this.selectedId != null && gone.has(this.selectedId)) this.selectedId = null;
    }
    if (deadDebris.length) this.debris = this.debris.filter((d) => !deadDebris.includes(d.id));
    for (const f of fragments) {
      if (this.debris.length >= TUNING.maxDebris) break;
      const d = createDebris(this.nextId++, f, "collision");
      this.debris.push(d);
      bus.emit({
        type: "debris-spawn",
        t: 0,
        id: d.id,
        angle: normalizeAngle(Math.atan2(f.y, f.x)),
        source: "collision",
      });
    }

    if (this.flashes.length) {
      for (const f of this.flashes) f.ttl -= dt;
      this.flashes = this.flashes.filter((f) => f.ttl > 0);
    }

    // Coverage + revenue. Each sat serves through its own band-scaled
    // footprint: higher orbits see more ground but pay a lower rate (latency).
    // When several sats cover at once, the best-paying one sets the rate.
    let rawCovered = false;
    let rate = 0;
    for (const s of this.sats) {
      if (!s.live || s.ascentRemaining > 0) continue;
      const r = Math.hypot(s.x, s.y);
      const hw = footprintHalfWidthFor(r, TUNING.footprintHalfWidth);
      if (!isAngleCovered([Math.atan2(s.y, s.x)], this.regionAngle, hw)) continue;
      rawCovered = true;
      rate = Math.max(rate, rateMultiplier(r));
    }
    if (rawCovered) {
      this.coverageLinger = TUNING.coverageGraceSec;
      this.coverageRateMult = rate;
    } else {
      this.coverageLinger = Math.max(0, this.coverageLinger - dt);
    }
    const nowCovered = rawCovered || this.coverageLinger > 0;
    if (nowCovered && !this.covered) bus.emit({ type: "coverage-start", t: 0 });
    if (!nowCovered && this.covered) bus.emit({ type: "coverage-gap", t: 0 });
    this.covered = nowCovered;

    if (nowCovered) {
      this.wallet = accrueRevenue(this.wallet, TUNING.coverageRate * this.coverageRateMult, dt);
      this.checkUnlocks();
      this.revenueAccum += dt;
      if (this.revenueAccum >= 0.5) {
        this.revenueAccum = 0;
        bus.emit({
          type: "revenue",
          t: 0,
          cash: this.wallet.cash,
          valuation: this.wallet.valuation,
        });
      }
    }

    // Fail states. Kessler first: a cascade is terminal regardless of cash.
    if (this.debris.length >= TUNING.kesslerCap) {
      this.endGame("kessler");
    } else if (isBankrupt(this.wallet.cash)) {
      this.endGame("bankruptcy");
    }

    this.pushSnapshot();
  }

  // ----- rendering -----

  private toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.cx + x, y: this.cy + y };
  }

  private render(): void {
    const g = this.gfx;
    g.clear();

    // Band guide rings — where LEO / MEO / GEO sit.
    for (const b of BANDS) {
      g.lineStyle(1, COL.guide, 0.6);
      g.strokeCircle(this.cx, this.cy, b.radius);
    }

    // Atmosphere: the drag zone, visible so a dipping perigee reads as danger.
    g.fillStyle(COL.atmosphere, 0.07);
    g.fillCircle(this.cx, this.cy, TUNING.atmosphereCeiling);
    g.lineStyle(1, COL.atmosphere, 0.25);
    g.strokeCircle(this.cx, this.cy, TUNING.atmosphereCeiling);

    // Contract region arc on the rim.
    const hw = TUNING.footprintHalfWidth;
    g.lineStyle(6, this.covered ? COL.covered : COL.gap, 1);
    g.beginPath();
    g.arc(
      this.cx,
      this.cy,
      TUNING.earthRadius + 4,
      this.regionAngle - hw,
      this.regionAngle + hw,
      false,
    );
    g.strokePath();

    // Earth + continents.
    g.fillStyle(COL.earth, 1);
    g.fillCircle(this.cx, this.cy, TUNING.earthRadius);
    g.fillStyle(COL.earthLand, 1);
    for (const lm of this.landmasses) {
      const c = pointOnCircle(this.cx, this.cy, lm.dist, this.earthSpin + lm.angle);
      g.fillPoints(
        lm.pts.map((p) => ({ x: c.x + p.x, y: c.y + p.y })),
        true,
      );
    }
    g.lineStyle(1.5, COL.atmosphere, 0.5);
    g.strokeCircle(this.cx, this.cy, TUNING.earthRadius);

    // Launch pads: active one bright, unlocked dim, locked dimmer still.
    for (const site of SITES) {
      const a = this.siteScreenAngle(site);
      const inner = pointOnCircle(this.cx, this.cy, TUNING.earthRadius + 2, a);
      const active = site.id === this.activeSiteId;
      const unlocked = this.unlockedIds.has(site.id);
      const outer = pointOnCircle(this.cx, this.cy, TUNING.earthRadius + (active ? 11 : 7), a);
      g.lineStyle(
        active ? 3 : 2,
        unlocked ? COL.pad : COL.guide,
        active ? 1 : unlocked ? 0.5 : 0.35,
      );
      g.lineBetween(inner.x, inner.y, outer.x, outer.y);
    }

    // Launch console: predicted trajectory + aim/power readout.
    if (this.consoleOpen && !this.gameOver) this.renderConsole(g);

    // Satellites.
    for (const s of this.sats) {
      if (s.ascentRemaining > 0) {
        const t = 1 - s.ascentRemaining / TUNING.launch.ascentSeconds;
        const p = ascentPoint(s.padX, s.padY, s.x, s.y, t);
        const sp = this.toScreen(p.x, p.y);
        g.fillStyle(COL.rocket, 1);
        g.fillCircle(sp.x, sp.y, 3);
        continue;
      }
      const sp = this.toScreen(s.x, s.y);
      const color = !s.live
        ? COL.danger
        : s.perigee >= TUNING.criticalPerigee + 25
          ? COL.healthy
          : s.perigee >= TUNING.criticalPerigee
            ? COL.warn
            : COL.danger;

      const r = Math.hypot(s.x, s.y);
      const angle = Math.atan2(s.y, s.x);

      // Coverage footprint: the slice of ground this sat is serving right now.
      // Widens with altitude (see bands), and brightens when it's over the
      // contract region — the main read for "is this bird earning?".
      if (s.live) {
        const fw = footprintHalfWidthFor(r, TUNING.footprintHalfWidth);
        const serving = Math.abs(angleDelta(angle, this.regionAngle)) <= fw;
        g.lineStyle(2, serving ? COL.covered : color, serving ? 0.75 : 0.22);
        g.beginPath();
        g.arc(this.cx, this.cy, r, angle - fw, angle + fw, false);
        g.strokePath();
        // Downlink cone to the ground it covers.
        g.lineStyle(1, serving ? COL.covered : color, serving ? 0.45 : 0.15);
        for (const edge of [-fw, fw]) {
          const foot = pointOnCircle(this.cx, this.cy, TUNING.earthRadius, angle + edge);
          g.lineBetween(sp.x, sp.y, foot.x, foot.y);
        }
      }

      if (s.id === this.selectedId) {
        g.lineStyle(2, COL.select, 0.9);
        g.strokeCircle(sp.x, sp.y, 13);
        // Show where the selected sat's orbit actually goes (drag included).
        const path = predictPath(TUNING.mu, s, DRAG, 14, TUNING.escapeRadius, 8, 0.03);
        g.fillStyle(COL.select, 0.35);
        for (const pt of path.points) {
          const q = this.toScreen(pt.x, pt.y);
          g.fillCircle(q.x, q.y, 1);
        }
      }

      // The satellite itself: a bus with two solar panels, wings laid along
      // the orbit track so it reads as a spacecraft rather than a pixel.
      const wx = -Math.sin(angle);
      const wy = Math.cos(angle);
      g.lineStyle(3, color, 0.85);
      g.lineBetween(sp.x + wx * 4, sp.y + wy * 4, sp.x + wx * 11, sp.y + wy * 11);
      g.lineBetween(sp.x - wx * 4, sp.y - wy * 4, sp.x - wx * 11, sp.y - wy * 11);
      g.fillStyle(color, 1);
      g.fillRect(sp.x - 4, sp.y - 4, 8, 8);
      // A boosting sat wears a bright ring while it climbs.
      if (s.raiseRemaining > 0) {
        g.lineStyle(2, COL.flash, 0.8);
        g.strokeCircle(sp.x, sp.y, 9);
      }
    }

    // Debris.
    g.fillStyle(COL.debris, 1);
    for (const d of this.debris) {
      const sp = this.toScreen(d.x, d.y);
      g.fillPoints(
        [
          { x: sp.x, y: sp.y - 4 },
          { x: sp.x + 4, y: sp.y },
          { x: sp.x, y: sp.y + 4 },
          { x: sp.x - 4, y: sp.y },
        ],
        true,
      );
    }

    // Collision flashes.
    for (const f of this.flashes) {
      const sp = this.toScreen(f.x, f.y);
      g.lineStyle(2, COL.flash, Math.max(0, f.ttl / 0.4));
      g.strokeCircle(sp.x, sp.y, 16 * (1 - f.ttl / 0.4) + 6);
    }

    this.hud.update({
      cash: this.wallet.cash,
      valuation: this.wallet.valuation,
      covered: this.covered,
      sats: this.sats.length,
      satCap: TUNING.maxSatellites,
      debris: this.debris.length,
      kesslerRisk: Math.min(1, this.debris.length / TUNING.kesslerCap),
      paused: this.paused,
      consoleOpen: this.consoleOpen,
      siteName: this.activeSite().name,
      nextUnlock: this.nextUnlock(),
    });

    if (this.gameOver && this.gameOverReason) {
      this.hud.showGameOver(this.gameOverReason, this.wallet.valuation);
    }
  }

  private renderConsole(g: Phaser.GameObjects.Graphics): void {
    const burnout = this.consoleBurnout();
    const path = predictPath(TUNING.mu, burnout, DRAG, 16, TUNING.escapeRadius, 6, 0.025);
    const el = orbitalElements(TUNING.mu, burnout);
    const stable = el.e < 1 && el.perigee >= TUNING.insertFloor;
    const color =
      path.outcome === "crashed"
        ? COL.danger
        : path.outcome === "escaped"
          ? COL.warn
          : stable
            ? COL.healthy
            : COL.warn;

    g.fillStyle(color, 0.5);
    for (const pt of path.points) {
      const q = this.toScreen(pt.x, pt.y);
      g.fillCircle(q.x, q.y, 1.4);
    }
    // Burnout point marker.
    const b = this.toScreen(burnout.x, burnout.y);
    g.lineStyle(1.5, color, 0.9);
    g.strokeCircle(b.x, b.y, 4);

    const L = TUNING.launch;
    const site = this.activeSite();
    const speed = Math.round(L.minSpeed + this.power * (L.maxSpeed - L.minSpeed));
    const atCap = this.power >= site.maxPower - 0.001 && site.maxPower < 1;
    const verdict =
      path.outcome === "crashed"
        ? "re-enters — will not orbit"
        : path.outcome === "escaped"
          ? "escape velocity — lost to space"
          : stable
            ? `${bandFor(el.apogee).label} orbit ${Math.round(el.perigee)}×${Math.round(el.apogee)}`
            : `low perigee ${Math.round(el.perigee)} — will decay`;
    this.consoleText.setText(
      `${site.name.toUpperCase()}   aim ${this.fpaDeg.toFixed(0)}°  power ${speed}` +
        `${atCap ? " (pad max)" : ""}   →  ${verdict}\n` +
        `←→ aim · ↑↓ power · ENTER launch ($${TUNING.launchCost}) · TAB pad · ESC close`,
    );
    this.consoleText.setColor(
      color === COL.healthy ? "#3dd6a0" : color === COL.warn ? "#ef9f27" : "#e24b4a",
    );
  }

  // ----- helpers -----

  private satNearScreen(x: number, y: number): Satellite | undefined {
    let best: Satellite | undefined;
    let bestD = 24 * 24;
    for (const s of this.sats) {
      if (s.ascentRemaining > 0) continue;
      const sp = this.toScreen(s.x, s.y);
      const d = (sp.x - x) * (sp.x - x) + (sp.y - y) * (sp.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private bindRestart(): void {
    this.gameOverBound = true;
    const restart = () => this.scene.restart();
    this.input.keyboard?.once("keydown-SPACE", restart);
    this.input.once("pointerdown", restart);
  }

  private pushSnapshot(): void {
    let minPerigee = Infinity;
    let live = 0;
    const fleet: { id: number; live: boolean; perigee: number; apogee: number }[] = [];
    for (const s of this.sats) {
      fleet.push({ id: s.id, live: s.live, perigee: s.perigee, apogee: s.apogee });
      if (!s.live) continue;
      live++;
      if (s.perigee < minPerigee) minPerigee = s.perigee;
    }
    getEventBus().updateSnapshot({
      ready: true,
      scene: "game",
      paused: this.paused,
      gameOver: this.gameOver,
      gameOverReason: this.gameOverReason,
      cash: this.wallet.cash,
      valuation: this.wallet.valuation,
      covered: this.covered,
      satellites: live,
      minPerigee: live ? minPerigee : 0,
      fleet,
      activeSite: this.activeSiteId,
      unlockedSites: SITES.filter((s) => this.unlockedIds.has(s.id)).map((s) => s.id),
      debris: this.debris.length,
      kesslerRisk: Math.min(1, this.debris.length / TUNING.kesslerCap),
      timeScale: this.cfg.timeScale,
    });
  }

  private emitFrame(): void {
    const now = performance.now();
    if (now - this.lastFrameEmit < 250) return;
    this.lastFrameEmit = now;
    const fps = Math.round(this.game.loop.actualFps);
    const entities = this.sats.length + this.debris.length;
    getEventBus().emit({ type: "frame", t: 0, fps, entities });
    getEventBus().updateSnapshot({ fps, entities });
  }
}
