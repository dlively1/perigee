// Event bridge exposed on `window.__PERIGEE` so Playwright (or any browser-side
// agent) can observe and drive the game without scraping pixels. Mirrors the
// spacemelon bridge pattern: a ring buffer of typed events + a live snapshot +
// imperative input/cheat hooks + awaitable wait helpers.

export type GameEvent =
  | { type: "boot"; t: number }
  | { type: "scene"; t: number; name: string }
  | { type: "run-start"; t: number; seed: number }
  // A launch was purchased; a rocket is climbing to the ring (not live yet).
  | { type: "launch"; t: number; id: number; angle: number; cost: number }
  // The rocket reached the ring; the satellite is now live and orbiting.
  | { type: "insert"; t: number; id: number; angle: number }
  | { type: "boost"; t: number; id: number; altitude: number; cost: number }
  // A live sat's altitude crossed below the critical threshold (fires once).
  | { type: "decay-critical"; t: number; id: number; altitude: number }
  // A sat's altitude hit zero — it burned up and is gone.
  | { type: "deorbit"; t: number; id: number }
  // Coverage of the contract region began / lapsed.
  | { type: "coverage-start"; t: number }
  | { type: "coverage-gap"; t: number }
  | { type: "revenue"; t: number; cash: number; valuation: number }
  | { type: "bankruptcy"; t: number; valuation: number }
  | { type: "frame"; t: number; fps: number; entities: number };

export interface GameSnapshot {
  ready: boolean;
  scene: string;
  seed: number;
  paused: boolean;
  gameOver: boolean;
  // Spendable cash (runway). Bankruptcy at <= 0.
  cash: number;
  // Cumulative revenue earned — the score.
  valuation: number;
  // Is the contract region currently served by a live satellite?
  covered: boolean;
  // Count of live satellites (excludes rockets still climbing).
  satellites: number;
  // Lowest altitude (0..1) across live sats, or 1 when none — the "most urgent".
  minAltitude: number;
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
    // Launch a satellite inserting at `angle` (radians around the ring).
    launch: (angle: number) => void;
    // Boost a satellite. With no id, boosts the most-urgent (lowest) live sat.
    boost: (id?: number) => void;
    pause: () => void;
  };
  // Test shortcuts — jump the game to a state instead of grinding toward it.
  cheat: {
    addCash: (amount: number) => void;
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
        cash: 0,
        valuation: 0,
        covered: false,
        satellites: 0,
        minAltitude: 1,
        fps: 0,
        entities: 0,
        timeScale: 1,
      },
      input: {
        launch: () => {},
        boost: () => {},
        pause: () => {},
      },
      cheat: {
        addCash: () => {},
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
