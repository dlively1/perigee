import Phaser from "phaser";
import { Rng } from "../agent/rng";
import { readAgentConfig, type AgentConfig } from "../agent/config";
import { getEventBus } from "../agent/events";
import { GameHud } from "../ui/GameHud";
import { TUNING } from "../sim/constants";
import { createSatellite, type Satellite } from "../sim/Satellite";
import { createDebris, type Debris, type DebrisSource } from "../sim/Debris";
import {
  TWO_PI,
  advanceAngle,
  boostAltitude,
  clamp01,
  decayAltitude,
  isAngleCovered,
  normalizeAngle,
  orbitRadius,
  pointOnCircle,
  willCollide,
} from "../core/orbit";
import { accrueRevenue, canAfford, isBankrupt, spend, type Wallet } from "../core/economy";

const COL = {
  earth: 0x17457f,
  earthLand: 0x2e7d5b,
  atmosphere: 0x4a90d9,
  ring: 0x2b3a56,
  healthy: 0x3dd6a0,
  warn: 0xef9f27,
  danger: 0xe24b4a,
  covered: 0x97c459,
  gap: 0xe24b4a,
  rocket: 0xe6ecf5,
  select: 0xffffff,
  debris: 0xd85a30,
  flash: 0xffd27a,
} as const;

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
  private earthSpin = 0; // cosmetic land rotation
  private covered = false;

  private paused = false;
  private gameOver = false;
  private gameOverReason: "bankruptcy" | "kessler" | null = null;
  private gameOverBound = false;

  private revenueAccum = 0;
  private lastFrameEmit = 0;
  // Ambient-debris scheduler (seeded): time accumulated + gap until next drop.
  private ambientTimer = 0;
  private ambientNextGap: number = TUNING.ambientFirstSec;
  // Transient collision flashes for rendering: {angle, radius, ttl}.
  private flashes: { angle: number; radius: number; ttl: number }[] = [];

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
    this.paused = this.cfg.paused;
    this.gameOver = false;
    this.gameOverReason = null;
    this.gameOverBound = false;
    this.revenueAccum = 0;
    this.ambientTimer = 0;
    this.ambientNextGap = TUNING.ambientFirstSec;

    this.gfx = this.add.graphics();
    this.hud = new GameHud(this);

    this.bindInput();

    bus.bindInput({
      launch: (angle) => this.doLaunch(angle),
      boost: (id) => this.doBoost(id),
      deorbit: (id) => this.doDeorbit(id),
      pause: () => this.togglePause(),
    });
    bus.bindCheats({
      addCash: (amount) => {
        this.wallet.cash += amount;
      },
      spawnDebris: (angle, alt) =>
        this.addDebris(angle ?? this.rng.range(0, TWO_PI), alt ?? 1, "cheat"),
    });

    bus.emit({ type: "scene", t: 0, name: "game" });
    bus.emit({ type: "run-start", t: 0, seed: this.cfg.seed });
    this.pushSnapshot();
  }

  private bindInput(): void {
    const kb = this.input.keyboard;
    kb?.on("keydown-SPACE", () => this.togglePause());
    kb?.on("keydown-B", () => this.doBoost());
    kb?.on("keydown-D", () => this.doDeorbit());
    kb?.on("keydown-L", () => this.doLaunch(this.pointerAngle()));

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      if (this.gameOver) return;
      const hit = this.satNearScreen(p.x, p.y);
      if (hit) {
        this.selectedId = hit.id;
      } else {
        this.doLaunch(Math.atan2(p.y - this.cy, p.x - this.cx));
      }
    });
  }

  // ----- actions -----

  private doLaunch(angle: number): void {
    if (this.gameOver) return;
    if (this.sats.length >= TUNING.maxSatellites) return;
    if (!canAfford(this.wallet.cash, TUNING.launchCost)) return;
    this.wallet.cash = spend(this.wallet.cash, TUNING.launchCost);
    const sat = createSatellite(
      this.nextId++,
      normalizeAngle(angle),
      TUNING.launchAltitude,
      TUNING.insertSeconds,
    );
    this.sats.push(sat);
    getEventBus().emit({
      type: "launch",
      t: 0,
      id: sat.id,
      angle: sat.angle,
      cost: TUNING.launchCost,
    });
    this.pushSnapshot();
  }

  private doBoost(id?: number): void {
    if (this.gameOver) return;
    const target = id != null ? this.sats.find((s) => s.id === id && s.live) : this.mostUrgent();
    if (!target) return;
    if (!canAfford(this.wallet.cash, TUNING.boostCost)) return;
    this.wallet.cash = spend(this.wallet.cash, TUNING.boostCost);
    target.alt = boostAltitude(target.alt, TUNING.boostAmount);
    if (target.alt >= TUNING.criticalAltitude) target.critical = false;
    getEventBus().emit({
      type: "boost",
      t: 0,
      id: target.id,
      altitude: target.alt,
      cost: TUNING.boostCost,
    });
    this.pushSnapshot();
  }

  // Command a clean de-orbit: pay a small fee to remove a sat before it dies or
  // gets hit — the counter-play to Kessler, since it leaves no debris.
  private doDeorbit(id?: number): void {
    if (this.gameOver) return;
    const target =
      id != null
        ? this.sats.find((s) => s.id === id && s.live)
        : this.selectedId != null
          ? this.sats.find((s) => s.id === this.selectedId && s.live)
          : this.mostUrgent();
    if (!target) return;
    if (!canAfford(this.wallet.cash, TUNING.deorbitCost)) return;
    this.wallet.cash = spend(this.wallet.cash, TUNING.deorbitCost);
    this.sats = this.sats.filter((s) => s.id !== target.id);
    if (this.selectedId === target.id) this.selectedId = null;
    getEventBus().emit({ type: "deorbit", t: 0, id: target.id, reason: "commanded" });
    this.pushSnapshot();
  }

  private togglePause(): void {
    if (this.gameOver) return;
    this.paused = !this.paused;
    getEventBus().updateSnapshot({ paused: this.paused });
  }

  private addDebris(angle: number, alt: number, source: DebrisSource): void {
    if (this.debris.length >= TUNING.maxDebris) return;
    const omega = TUNING.satOmega * TUNING.debrisOmegaFactor;
    const d = createDebris(this.nextId++, normalizeAngle(angle), clamp01(alt), omega, source);
    this.debris.push(d);
    getEventBus().emit({ type: "debris-spawn", t: 0, id: d.id, angle: d.angle, source });
  }

  private endGame(reason: "bankruptcy" | "kessler"): void {
    if (this.gameOver) return;
    this.gameOver = true;
    this.gameOverReason = reason;
    const bus = getEventBus();
    if (reason === "bankruptcy") {
      this.wallet.cash = 0;
      bus.emit({ type: "bankruptcy", t: 0, valuation: this.wallet.valuation });
    } else {
      bus.emit({ type: "kessler-cascade", t: 0, debris: this.debris.length });
    }
    bus.emit({ type: "game-over", t: 0, reason, valuation: this.wallet.valuation });
  }

  private mostUrgent(): Satellite | undefined {
    let best: Satellite | undefined;
    for (const s of this.sats) {
      if (!s.live) continue;
      if (!best || s.alt < best.alt) best = s;
    }
    return best;
  }

  // ----- loop -----

  update(_time: number, delta: number): void {
    if (!this.gameOver && !this.paused) {
      // Clamp the frame delta so a backgrounded tab can't teleport the sim.
      const dt = (Math.min(delta, 100) / 1000) * this.cfg.timeScale;
      this.step(dt);
    }
    this.render();
    this.emitFrame();

    if (this.gameOver && !this.gameOverBound) {
      this.bindRestart();
    }
  }

  private step(dt: number): void {
    const bus = getEventBus();
    this.regionAngle = advanceAngle(this.regionAngle, TUNING.earthOmega, dt);
    this.earthSpin = advanceAngle(this.earthSpin, TUNING.earthOmega, dt);

    // Ambient external junk arrives on a seeded schedule — the cascade seed.
    if (this.cfg.debris) {
      this.ambientTimer += dt;
      if (this.ambientTimer >= this.ambientNextGap) {
        this.ambientTimer = 0;
        this.ambientNextGap = this.rng.range(TUNING.ambientMinGapSec, TUNING.ambientMaxGapSec);
        this.addDebris(this.rng.range(0, TWO_PI), 1, "ambient");
      }
    }

    // Satellites: insert climbing rockets, then orbit + decay the live ones.
    // A decay death is a clean re-entry — it burns up and leaves NO debris.
    const deadSats: number[] = [];
    for (const s of this.sats) {
      if (!s.live) {
        s.insertRemaining -= dt;
        if (s.insertRemaining <= 0) {
          s.live = true;
          s.insertRemaining = 0;
          bus.emit({ type: "insert", t: 0, id: s.id, angle: s.angle });
        }
        continue;
      }
      s.angle = advanceAngle(s.angle, TUNING.satOmega, dt);
      s.alt = decayAltitude(s.alt, TUNING.decayPerSec, dt);
      if (s.alt <= 0) {
        deadSats.push(s.id);
        bus.emit({ type: "deorbit", t: 0, id: s.id, reason: "decay" });
      } else if (s.alt < TUNING.criticalAltitude && !s.critical) {
        s.critical = true;
        bus.emit({ type: "decay-critical", t: 0, id: s.id, altitude: s.alt });
      }
    }

    // Debris: orbits at its own faster speed and burns up as it decays.
    const deadDebris: number[] = [];
    for (const d of this.debris) {
      d.angle = advanceAngle(d.angle, d.omega, dt);
      d.alt = decayAltitude(d.alt, TUNING.debrisDecayPerSec, dt);
      if (d.alt <= 0) {
        deadDebris.push(d.id);
        bus.emit({ type: "debris-decay", t: 0, id: d.id });
      }
    }

    // Collisions: a live sat struck by debris is destroyed and both shatter
    // into fragments — this is the multiplier that turns junk into a cascade.
    const fragments: { angle: number; alt: number }[] = [];
    for (const s of this.sats) {
      if (!s.live || deadSats.includes(s.id)) continue;
      const sr = orbitRadius(TUNING.ringRadius, s.alt);
      for (const d of this.debris) {
        if (deadDebris.includes(d.id)) continue;
        const dr = orbitRadius(TUNING.ringRadius, d.alt);
        if (!willCollide(s.angle, sr, d.angle, dr, TUNING.collisionAngle, TUNING.collisionRadius)) {
          continue;
        }
        deadSats.push(s.id);
        deadDebris.push(d.id);
        bus.emit({ type: "collision", t: 0, satId: s.id, debrisId: d.id, angle: s.angle });
        bus.emit({ type: "deorbit", t: 0, id: s.id, reason: "collision" });
        this.flashes.push({ angle: s.angle, radius: sr, ttl: 0.4 });
        const n = TUNING.fragmentsPerCollision;
        for (let i = 0; i < n; i++) {
          fragments.push({
            angle: s.angle + (i - (n - 1) / 2) * TUNING.collisionAngle * 2,
            alt: clamp01(s.alt + this.rng.range(-0.12, 0.12)),
          });
        }
        break; // this sat is gone; stop checking it against more debris
      }
    }

    if (deadSats.length) {
      this.sats = this.sats.filter((s) => !deadSats.includes(s.id));
      if (this.selectedId != null && deadSats.includes(this.selectedId)) this.selectedId = null;
    }
    if (deadDebris.length) this.debris = this.debris.filter((d) => !deadDebris.includes(d.id));
    for (const f of fragments) this.addDebris(f.angle, f.alt, "collision");

    // Fade collision flashes.
    if (this.flashes.length) {
      for (const f of this.flashes) f.ttl -= dt;
      this.flashes = this.flashes.filter((f) => f.ttl > 0);
    }

    // Coverage + revenue.
    const liveAngles: number[] = [];
    for (const s of this.sats) if (s.live) liveAngles.push(s.angle);
    const nowCovered = isAngleCovered(liveAngles, this.regionAngle, TUNING.footprintHalfWidth);
    if (nowCovered && !this.covered) bus.emit({ type: "coverage-start", t: 0 });
    if (!nowCovered && this.covered) bus.emit({ type: "coverage-gap", t: 0 });
    this.covered = nowCovered;

    if (nowCovered) {
      this.wallet = accrueRevenue(this.wallet, TUNING.coverageRate, dt);
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

    // Fail states. Kessler is checked first: a cascade is terminal regardless
    // of the balance sheet.
    if (this.debris.length >= TUNING.kesslerCap) {
      this.endGame("kessler");
    } else if (isBankrupt(this.wallet.cash)) {
      this.endGame("bankruptcy");
    }

    this.pushSnapshot();
  }

  // ----- rendering -----

  private render(): void {
    const g = this.gfx;
    g.clear();

    // Orbit ring.
    g.lineStyle(1, COL.ring, 1);
    g.strokeCircle(this.cx, this.cy, TUNING.ringRadius);

    // Contract region: an arc on Earth's rim, ±footprint, lit when covered.
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

    // Earth + a couple of rotating land blobs.
    g.fillStyle(COL.earth, 1);
    g.fillCircle(this.cx, this.cy, TUNING.earthRadius);
    g.fillStyle(COL.earthLand, 1);
    for (const [aOff, rOff, size] of [
      [0.4, 0.35, 20],
      [2.3, 0.5, 16],
      [4.1, 0.25, 22],
    ] as const) {
      const p = pointOnCircle(this.cx, this.cy, TUNING.earthRadius * rOff, this.earthSpin + aOff);
      g.fillCircle(p.x, p.y, size);
    }
    g.lineStyle(1.5, COL.atmosphere, 0.5);
    g.strokeCircle(this.cx, this.cy, TUNING.earthRadius);

    // Satellites (and climbing rockets).
    for (const s of this.sats) {
      if (!s.live) {
        const progress = 1 - s.insertRemaining / TUNING.insertSeconds;
        const r = TUNING.earthRadius + (TUNING.ringRadius - TUNING.earthRadius) * progress;
        const p = pointOnCircle(this.cx, this.cy, r, s.angle);
        g.lineStyle(1, COL.rocket, 0.3);
        g.lineBetween(this.cx, this.cy, p.x, p.y);
        g.fillStyle(COL.rocket, 1);
        g.fillCircle(p.x, p.y, 3);
        continue;
      }
      const r = orbitRadius(TUNING.ringRadius, s.alt);
      const p = pointOnCircle(this.cx, this.cy, r, s.angle);
      const color =
        s.alt >= 0.5 ? COL.healthy : s.alt >= TUNING.criticalAltitude ? COL.warn : COL.danger;

      // Footprint hint under the sat.
      g.lineStyle(2, color, 0.25);
      g.beginPath();
      g.arc(this.cx, this.cy, r, s.angle - hw, s.angle + hw, false);
      g.strokePath();

      if (s.id === this.selectedId) {
        g.lineStyle(2, COL.select, 0.9);
        g.strokeCircle(p.x, p.y, 11);
      }
      g.fillStyle(color, 1);
      g.fillRect(p.x - 6, p.y - 6, 12, 12);
    }

    // Debris — small tumbling diamonds in the danger colour.
    g.fillStyle(COL.debris, 1);
    for (const d of this.debris) {
      const r = orbitRadius(TUNING.ringRadius, d.alt);
      const p = pointOnCircle(this.cx, this.cy, r, d.angle);
      g.fillPoints(
        [
          { x: p.x, y: p.y - 4 },
          { x: p.x + 4, y: p.y },
          { x: p.x, y: p.y + 4 },
          { x: p.x - 4, y: p.y },
        ],
        true,
      );
    }

    // Collision flashes.
    for (const f of this.flashes) {
      const p = pointOnCircle(this.cx, this.cy, f.radius, f.angle);
      g.lineStyle(2, COL.flash, Math.max(0, f.ttl / 0.4));
      g.strokeCircle(p.x, p.y, 16 * (1 - f.ttl / 0.4) + 6);
    }

    this.hud.update({
      cash: this.wallet.cash,
      valuation: this.wallet.valuation,
      covered: this.covered,
      sats: this.sats.filter((s) => s.live).length,
      debris: this.debris.length,
      kesslerRisk: Math.min(1, this.debris.length / TUNING.kesslerCap),
      paused: this.paused,
    });

    if (this.gameOver && this.gameOverReason) {
      this.hud.showGameOver(this.gameOverReason, this.wallet.valuation);
    }
  }

  // ----- helpers -----

  private pointerAngle(): number {
    const p = this.input.activePointer;
    return Math.atan2(p.y - this.cy, p.x - this.cx);
  }

  private satNearScreen(x: number, y: number): Satellite | undefined {
    let best: Satellite | undefined;
    let bestD = 24 * 24;
    for (const s of this.sats) {
      if (!s.live) continue;
      const r = orbitRadius(TUNING.ringRadius, s.alt);
      const p = pointOnCircle(this.cx, this.cy, r, s.angle);
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
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
    let minAlt = 1;
    let live = 0;
    for (const s of this.sats) {
      if (!s.live) continue;
      live++;
      if (s.alt < minAlt) minAlt = s.alt;
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
      minAltitude: minAlt,
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
    getEventBus().emit({ type: "frame", t: 0, fps, entities: this.sats.length });
    getEventBus().updateSnapshot({ fps, entities: this.sats.length });
  }
}
