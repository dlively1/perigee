// Event bridge exposed on `window.__PERIGEE` so Playwright (or any browser-side
// agent) can observe and drive the game without scraping pixels. Mirrors the
// spacemelon bridge pattern: a ring buffer of typed events + a live snapshot +
// imperative input/cheat hooks + awaitable wait helpers.

export type GameEvent =
  | { type: "boot"; t: number }
  | { type: "scene"; t: number; name: string }
  | { type: "run-start"; t: number; seed: number }
  // A launch was purchased; the rocket is riding its ascent to burnout.
  // `fpa` = flight-path angle (deg from tangential), `power` = 0..1 dial.
  | { type: "launch"; t: number; id: number; fpa: number; power: number; cost: number }
  // The burnout orbit's perigee cleared the insert floor — the satellite is
  // live and earning. Carries the achieved orbit.
  | { type: "insert"; t: number; id: number; perigee: number; apogee: number }
  // Prograde Δv applied. `perigee` is the post-boost value — boosting near
  // apogee raises it most (that's the skill).
  | { type: "boost"; t: number; id: number; dv: number; perigee: number; cost: number }
  // A live sat's perigee dipped below the critical radius (fires once per dip).
  | { type: "decay-critical"; t: number; id: number; perigee: number }
  // A satellite is gone. `decay` = a live sat dragged down and burned up;
  // `crash` = a botched launch that never made orbit; `escaped` = flung past
  // the escape radius; `collision` = struck by debris (spawns fragments);
  // `commanded` = the player paid to de-orbit it cleanly.
  | {
      type: "deorbit";
      t: number;
      id: number;
      reason: "decay" | "crash" | "escaped" | "collision" | "commanded";
    }
  // A piece of debris appeared / burned up (or escaped).
  | {
      type: "debris-spawn";
      t: number;
      id: number;
      angle: number;
      source: "ambient" | "collision" | "cheat";
    }
  | { type: "debris-decay"; t: number; id: number }
  // A live sat and a debris struck each other (positions within collisionDist).
  | { type: "collision"; t: number; satId: number; debrisId: number; angle: number }
  // Debris density crossed the cascade threshold — the ring is lost.
  | { type: "kessler-cascade"; t: number; debris: number }
  // A player order couldn't execute (and the HUD said why).
  | {
      type: "action-blocked";
      t: number;
      action: "launch" | "boost" | "deorbit" | "select-site";
      reason: "cash" | "max-sats" | "no-target" | "locked" | "unknown";
    }
  // Valuation crossed a launch site's threshold — it's now available.
  | { type: "site-unlocked"; t: number; siteId: string }
  // Coverage of the contract region began / lapsed.
  | { type: "coverage-start"; t: number }
  | { type: "coverage-gap"; t: number }
  | { type: "revenue"; t: number; cash: number; valuation: number }
  | { type: "bankruptcy"; t: number; valuation: number }
  | { type: "game-over"; t: number; reason: "bankruptcy" | "kessler"; valuation: number }
  | { type: "frame"; t: number; fps: number; entities: number };

export interface GameSnapshot {
  ready: boolean;
  scene: string;
  seed: number;
  paused: boolean;
  gameOver: boolean;
  // Why the run ended, or null while it's live.
  gameOverReason: "bankruptcy" | "kessler" | null;
  // Spendable cash (runway). Bankruptcy at <= 0.
  cash: number;
  // Cumulative revenue earned — the score.
  valuation: number;
  // Is the contract region currently served by a live satellite?
  covered: boolean;
  // Count of live satellites (excludes rockets still climbing / botched lobs).
  satellites: number;
  // Lowest perigee (px from Earth's center) across live sats, 0 when none —
  // the most-urgent orbit. Compare against criticalPerigee.
  minPerigee: number;
  // Per-sat orbit summary for agents: id, live flag, cached perigee/apogee.
  fleet: { id: number; live: boolean; perigee: number; apogee: number }[];
  // Active launch site + which sites valuation has unlocked.
  activeSite: string;
  unlockedSites: string[];
  // Pieces of debris currently in orbit.
  debris: number;
  // Kessler risk, 0..1 — debris count as a fraction of the cascade cap.
  kesslerRisk: number;
  fps: number;
  entities: number;
  timeScale: number;
}

export interface GameBridge {
  version: 1;
  events: GameEvent[];
  snapshot: GameSnapshot;
  // Imperative hooks (used by tests + autoplay). Bound by GameScene; no-op
  // until a run is active.
  input: {
    // Fire from the active launch site: `fpaDeg` = flight-path angle in
    // degrees (0 = tangential/ideal), `power` = 0..1 speed dial.
    launch: (fpaDeg: number, power: number) => void;
    // Boost a satellite (prograde Δv). With no id, boosts the selected sat,
    // else the one with the lowest perigee.
    boost: (id?: number) => void;
    // Command a clean de-orbit (no debris). With no id, de-orbits the selected
    // sat, else the lowest-perigee one.
    deorbit: (id?: number) => void;
    // Switch the active launch site (must be unlocked).
    selectSite: (siteId: string) => void;
    pause: () => void;
  };
  // Test shortcuts — jump the game to a state instead of grinding toward it.
  cheat: {
    addCash: (amount: number) => void;
    // Raise valuation directly (drives site unlocks in tests).
    addValuation: (amount: number) => void;
    // Place a live satellite directly on orbit: circular speed at `radius`
    // scaled by `vFactor` (1 = circular, negative = retrograde).
    spawnSat: (angle: number, radius: number, vFactor?: number) => void;
    // Drop debris on orbit the same way. Defaults: random angle, LEO radius.
    spawnDebris: (angle?: number, radius?: number, vFactor?: number) => void;
  };
  waitFor: (predicate: (s: GameSnapshot) => boolean, timeoutMs?: number) => Promise<GameSnapshot>;
  waitForEvent: <T extends GameEvent["type"]>(
    type: T,
    timeoutMs?: number,
  ) => Promise<Extract<GameEvent, { type: T }>>;
}

declare global {
  interface Window {
    __PERIGEE?: GameBridge;
  }
}

const MAX_EVENTS = 2000;
const TRIM_SLACK = 256;

class EventBus {
  private bridge: GameBridge;
  private listeners = new Set<(e: GameEvent) => void>();
  private snapshotListeners = new Set<(s: GameSnapshot) => void>();

  constructor(seed: number) {
    this.bridge = {
      version: 1,
      events: [],
      snapshot: {
        ready: false,
        scene: "boot",
        seed,
        paused: false,
        gameOver: false,
        gameOverReason: null,
        cash: 0,
        valuation: 0,
        covered: false,
        satellites: 0,
        minPerigee: 0,
        fleet: [],
        activeSite: "",
        unlockedSites: [],
        debris: 0,
        kesslerRisk: 0,
        fps: 0,
        entities: 0,
        timeScale: 1,
      },
      input: {
        launch: () => {},
        boost: () => {},
        deorbit: () => {},
        selectSite: () => {},
        pause: () => {},
      },
      cheat: {
        addCash: () => {},
        addValuation: () => {},
        spawnSat: () => {},
        spawnDebris: () => {},
      },
      waitFor: (predicate, timeoutMs = 10_000) =>
        new Promise((resolve, reject) => {
          if (predicate(this.bridge.snapshot)) {
            resolve({ ...this.bridge.snapshot });
            return;
          }
          const timer = setTimeout(() => {
            this.snapshotListeners.delete(handler);
            reject(new Error(`waitFor timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          const handler = (s: GameSnapshot) => {
            if (predicate(s)) {
              clearTimeout(timer);
              this.snapshotListeners.delete(handler);
              resolve({ ...s });
            }
          };
          this.snapshotListeners.add(handler);
        }),
      waitForEvent: <T extends GameEvent["type"]>(type: T, timeoutMs = 10_000) =>
        new Promise<Extract<GameEvent, { type: T }>>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.listeners.delete(handler);
            reject(new Error(`waitForEvent(${type}) timeout after ${timeoutMs}ms`));
          }, timeoutMs);
          const handler = (e: GameEvent) => {
            if (e.type === type) {
              clearTimeout(timer);
              this.listeners.delete(handler);
              resolve(e as Extract<GameEvent, { type: T }>);
            }
          };
          this.listeners.add(handler);
        }),
    };
    window.__PERIGEE = this.bridge;
  }

  bindInput(input: GameBridge["input"]): void {
    this.bridge.input = input;
  }

  bindCheats(cheat: GameBridge["cheat"]): void {
    this.bridge.cheat = cheat;
  }

  emit(event: GameEvent): void {
    // Stamp `t` with a monotonic clock regardless of what the caller passed.
    // Phaser's scene clock resets across scene restarts, which would break
    // `event.t > since` filters; performance.now() stays monotonic per page.
    event.t = performance.now();
    const events = this.bridge.events;
    events.push(event);
    if (events.length > MAX_EVENTS + TRIM_SLACK) {
      this.bridge.events = events.slice(events.length - MAX_EVENTS);
    }
    for (const fn of this.listeners) fn(event);
  }

  updateSnapshot(patch: Partial<GameSnapshot>): void {
    Object.assign(this.bridge.snapshot, patch);
    for (const fn of this.snapshotListeners) fn(this.bridge.snapshot);
  }

  get snapshot(): GameSnapshot {
    return this.bridge.snapshot;
  }
}

let busInstance: EventBus | null = null;

export function initEventBus(seed: number): EventBus {
  if (!busInstance) busInstance = new EventBus(seed);
  return busInstance;
}

export function getEventBus(): EventBus {
  if (!busInstance) throw new Error("EventBus not initialized");
  return busInstance;
}
