# Perigee — Agent Handbook

Soft-real-time satellite-startup game. You're a scrappy space-internet company:
**launch** satellites onto an orbital ring, fight their constant **altitude
decay** by spending to **boost** them, and earn by holding **sustained
coverage** over a contracted ground region — without running your **runway**
(cash) to zero. Score is your company **valuation**.

This document is the first-class spec for any agent (Claude, scripted, or
human) working the codebase. `AGENTS.md` is a symlink to this file — edit only
`CLAUDE.md`.

> Architecture deliberately mirrors the sibling `spacemelon` project: a typed
> event bridge on `window`, seeded-deterministic sim, pure unit-tested rules,
> data-driven tuning, and 100% procedural art (no asset binaries).

## Stack

- **Phaser 3**, **TypeScript** (strict), **Vite**, **pnpm**.
- **Vitest** for pure-logic unit tests (ms-fast, no browser).
- **Playwright** for end-to-end browser tests against a real built bundle.
- All art is drawn procedurally with Phaser `Graphics` in the scenes — the repo
  stays text-only.

## Commands

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `pnpm install`      | Install deps.                                             |
| `pnpm dev`          | Vite dev server at http://localhost:5173.                 |
| `pnpm build`        | Type-check + production build to `dist/`.                 |
| `pnpm preview`      | Serve the production build on :4173 (used by Playwright). |
| `pnpm typecheck`    | `tsc --noEmit`.                                           |
| `pnpm test:unit`    | Vitest unit tests for the pure sim (`src/core/`).         |
| `pnpm test`         | Playwright e2e (auto-boots `build && preview`).           |
| `pnpm test:install` | One-time: install Playwright chromium + system deps.      |
| `pnpm lint`         | ESLint — includes the `Math.random()` ban in `src/`.      |
| `pnpm format`       | Prettier write (`format:check` is what CI runs).          |

If the environment can't download Playwright's pinned browser, point the suite
at a preinstalled Chromium: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome pnpm test`.

## Repository map

```
src/
  main.ts               Phaser boot
  agent/
    config.ts           URL-param config (seed, autoplay, debug, paused, muted, timeScale)
    rng.ts              Seedable mulberry32 PRNG — deterministic runs
    events.ts           window.__PERIGEE bridge (events, snapshot, input, cheat, waitFor*)
  core/                 PURE, unit-tested logic — no Phaser, no state
    orbit.ts            Angles, altitude decay/boost, spiral radius, coverage test
    economy.ts          Revenue accrual, affordability, bankruptcy
  sim/
    constants.ts        TUNING — every feel knob (geometry, motion, decay, economy)
    Satellite.ts        Satellite state record + factory
  scenes/
    BootScene.ts        Emit boot → menu
    MenuScene.ts        Title; SPACE/click → game (or autoplay)
    GameScene.ts        The MVP loop: launch, decay, boost, coverage, bankruptcy
  ui/
    GameHud.ts          Runway / valuation / coverage overlay + bankruptcy panel
tests/
  helpers/gameClient.ts Typed wrappers around the bridge for Playwright
  smoke.spec.ts         Boot, launch/insert, decay/deorbit, boost, coverage, bankruptcy
  unit/                 Vitest unit tests for core/ (orbit, economy)
```

## The agent loop (THIS IS THE LOAD-BEARING PART)

Every gameplay-relevant action emits a structured event and updates a snapshot
on `window.__PERIGEE`. Tests and agents observe/drive state through this bridge
instead of scraping pixels.

### URL params (all optional)

| Param       | Type           | Default    | Notes                                       |
| ----------- | -------------- | ---------- | ------------------------------------------- |
| `seed`      | int or `0xHEX` | `0xC0FFEE` | Feeds the deterministic RNG (region angle). |
| `autoplay`  | `1` / `true`   | off        | Skip the menu, start the game immediately.  |
| `debug`     | `1` / `true`   | off        | Reserved for a future debug HUD.            |
| `paused`    | `1` / `true`   | off        | Boot paused (handy for screenshots).        |
| `muted`     | `1` / `true`   | off        | Reserved (no audio yet).                    |
| `timeScale` | float 1–8      | `1`        | Run the sim N× faster for slow e2e waits.   |

Example: `http://localhost:5173/?seed=42&autoplay=1&timeScale=4`

### Browser-side bridge

```ts
window.__PERIGEE = {
  version: 1,
  events: GameEvent[],          // ring buffer, last ~2000 entries
  snapshot: {
    ready, scene, seed, paused, gameOver,
    cash, valuation, covered, satellites, minAltitude, fps, entities, timeScale
  },
  input: {                      // headless input (works even while paused)
    launch(angle), boost(id?), pause()
  },
  cheat: { addCash(amount) },   // test shortcut — jump the wallet to a state
  waitFor(predicate, timeoutMs?),
  waitForEvent(type, timeoutMs?),
};
```

### Event types

`boot`, `scene`, `run-start`, `launch`, `insert`, `boost`, `decay-critical`,
`deorbit`, `coverage-start`, `coverage-gap`, `revenue`, `bankruptcy`, `frame`.
All carry `t` (ms since boot, monotonic). Exact shapes in `src/agent/events.ts`.

## Conventions

- **Determinism first.** Any randomness goes through `Rng` seeded from
  `AgentConfig.seed`. Never call `Math.random()` in gameplay code — ESLint
  enforces this in `src/`.
- **Rules are pure and tested.** New sim math goes in `src/core/` as a pure
  function with a Vitest test — not buried in `GameScene`. Unit tests run in
  milliseconds; the e2e suite takes longer.
- **Feel is data.** Tuning lives in `src/sim/constants.ts` (`TUNING`). Tweak
  balance there, not with magic numbers in the scene.
- **Add events for new observable state.** If you add something an agent might
  want to watch (debris spawned, contract fulfilled, funding round), add a
  `GameEvent` variant, emit it, and add a `gameClient` helper if it keeps tests
  short.
- **Procedural art only.** Draw with Phaser `Graphics`; no image/audio binaries.

## Closed-loop workflow

1. Make the change.
2. `pnpm typecheck` — fast "did I break types".
3. `pnpm test:unit` — for anything touching `src/core/`.
4. `pnpm test` — Playwright builds, serves, and runs the e2e suite.
5. If a feature added observable state, ensure there's an event + a test that
   asserts it fires.

## Roadmap beyond the MVP (deferred — do not add without scoping)

The MVP is intentionally one ring with launch / decay / boost / coverage /
bankruptcy. Deferred layers, in rough order: **debris + Kessler cascade**,
**eclipse / battery**, multiple rings (MEO/GEO), a contract/economy meta with
**funding rounds** and a tech tree, cheap-rocket **launch failures**, and
**de-orbit** tugs. See `perigee-design-brief.md` in the workspace for the full
design intent and the two-fail-state tension (bankruptcy vs. Kessler) that the
whole game is built around.
