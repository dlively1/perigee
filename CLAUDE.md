# Perigee — Agent Handbook

Soft-real-time satellite-strategy game. You're a scrappy space-internet
company: **launch** rockets from your pad into real Newtonian orbits (aim +
power pick the burnout state), fight atmospheric **drag** on every low perigee
pass by spending on prograde **boosts**, and earn by holding **sustained
coverage** over a contracted ground region — without running your cash to zero
(bankruptcy) or littering the sky into a **Kessler cascade**. Score is your
company **valuation**.

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

## The physics model (read this before touching the sim)

Since the trajectory-launch rewrite, orbits are REAL 2D Newtonian conics:

- Earth sits at the origin; everything integrates under point gravity
  (`TUNING.mu`) with semi-implicit Euler + substeps (`stepBody`).
- A linear-density **atmosphere** (surface → `atmosphereCeiling`) drags
  anything flying low. LEO sits in the thin upper tail, so LEO sats need
  periodic boosts; orbits above the ceiling coast for free. A low perigee =
  drag every pass = the death spiral the game is named for.
- **Launching**: the ascent is a cosmetic animation (game-scale surface
  gravity is unfightable); the player's aim + power choose the upper stage's
  **burnout state** at `launch.burnoutRadius`. Power sets insertion speed
  (→ apogee); aim sets flight-path angle (0 = tangential = healthy perigee).
  The stage inherits Earth-rotation speed, so prograde launches are cheaper.
- **Insert** = burnout perigee cleared `insertFloor` (a real orbit, not a lob).
- **Boost** = prograde Δv. It raises the OPPOSITE side of the orbit — boosting
  near apogee is how you lift a transfer ellipse's perigee out of the drag.
  Reaching a high orbit = launch a transfer, coast to apogee, boost. This is
  deliberate: the skill curve teaches real orbital mechanics with one button.
- Calibrated envelope (aim 0°): power ≈ 0.25 → circular LEO; ≈ 0.45 → MEO
  transfer; ≈ 0.62 → GEO transfer; near 1.0 flirts with escape. Unboosted LEO
  decays in ~70s with ~30s of critical warning.

## Progression (bands + sites)

Two data registries drive the whole meta layer — extend these, not the scene:

- **`src/sim/bands.ts`** — LEO / MEO / GEO, classified by current radius (so
  an eccentric orbit is judged by where it is _now_). Higher = safer (above
  the drag ceiling, away from ambient junk) and a wider footprint, but a lower
  `rateMult`: high-orbit internet has latency, so contracts pay less. That's
  the core trade — LEO pays best and dies fastest.
- **`src/sim/sites.ts`** — launch pads, fixed in the Earth frame (they rotate
  with the planet). Each caps the console's power dial via `maxPower`, and
  auto-unlocks when **valuation** reaches `unlockValuation`. That's the
  economy split made concrete: **cash operates, valuation unlocks.** The
  starter pad tops out around LEO; the best pad reaches GEO transfers.

When several sats cover the region at once, the best-paying (lowest) band sets
the rate. Unlocks are checked as revenue accrues, and emit `site-unlocked`.

## Repository map

```
src/
  main.ts               Phaser boot
  agent/
    config.ts           URL-param config (seed, autoplay, debug, paused, muted, debris, timeScale)
    rng.ts              Seedable mulberry32 PRNG — deterministic runs
    events.ts           window.__PERIGEE bridge (events, snapshot, input, cheat, waitFor*)
  core/                 PURE, unit-tested logic — no Phaser, no state
    orbit.ts            Gravity integrator, orbital elements, drag, burnout launch
                        model, trajectory prediction, angles, coverage test
    economy.ts          Revenue accrual, affordability, bankruptcy
  sim/
    constants.ts        TUNING — every feel knob (gravity, atmosphere, launch,
                        economy, debris) + DRAG model bundle
    Satellite.ts        Satellite = physics body + lifecycle (ascent/live/critical)
    Debris.ts           Debris = physics body + source tag
    bands.ts            LEO/MEO/GEO registry — classification, pay rate, footprint
    sites.ts            Launch-pad registry — angle, power cap, valuation unlock
  scenes/
    BootScene.ts        Emit boot → menu
    MenuScene.ts        Title; SPACE/click → game (or autoplay)
    GameScene.ts        Sim loop, launch console, collisions, coverage, fail states
  ui/
    GameHud.ts          Cash/valuation/coverage/Kessler overlay + toasts + game-over
tests/
  helpers/gameClient.ts Typed wrappers around the bridge for Playwright
  smoke.spec.ts         Launch good/botched, drag decay, boost, coverage, debris,
                        collision, cascade, bankruptcy
  unit/                 Vitest unit tests for core/ (orbit physics, economy)
```

## The agent loop (THIS IS THE LOAD-BEARING PART)

Every gameplay-relevant action emits a structured event and updates a snapshot
on `window.__PERIGEE`. Tests and agents observe/drive state through this bridge
instead of scraping pixels.

### URL params (all optional)

| Param       | Type           | Default    | Notes                                      |
| ----------- | -------------- | ---------- | ------------------------------------------ |
| `seed`      | int or `0xHEX` | `0xC0FFEE` | Feeds the deterministic RNG.               |
| `autoplay`  | `1` / `true`   | off        | Skip the menu, start the game immediately. |
| `debug`     | `1` / `true`   | off        | Reserved for a future debug HUD.           |
| `paused`    | `1` / `true`   | off        | Boot paused (handy for screenshots).       |
| `muted`     | `1` / `true`   | off        | Reserved (no audio yet).                   |
| `debris`    | `0` / `false`  | on         | Disable ambient junk (isolates lifecycle). |
| `timeScale` | float 1–8      | `1`        | Run the sim N× faster for slow e2e waits.  |

Example: `http://localhost:5173/?seed=42&autoplay=1&timeScale=4`

### Browser-side bridge

```ts
window.__PERIGEE = {
  version: 1,
  events: GameEvent[],          // ring buffer, last ~2000 entries
  snapshot: {
    ready, scene, seed, paused, gameOver, gameOverReason,
    cash, valuation, covered, satellites, minPerigee,
    fleet: [{ id, live, perigee, apogee }],
    activeSite, unlockedSites: string[],
    debris, kesslerRisk, fps, entities, timeScale
  },
  input: {                      // headless input (works even while paused)
    launch(fpaDeg, power),      // fire from the active pad (power capped by it)
    boost(id?),                 // prograde Δv (selected sat, else lowest perigee)
    deorbit(id?),               // clean removal, no debris
    selectSite(siteId),         // switch pads (must be unlocked)
    pause()
  },
  cheat: {                      // test shortcuts — jump to a state
    addCash(amount),
    addValuation(amount),                 // drives site unlocks
    spawnSat(angle, radius, vFactor?),    // live sat on orbit (1 = circular)
    spawnDebris(angle?, radius?, vFactor?)
  },
  waitFor(predicate, timeoutMs?),
  waitForEvent(type, timeoutMs?),
};
```

### Event types

`boot`, `scene`, `run-start`, `launch`, `insert`, `boost`, `decay-critical`,
`deorbit` (reason: decay | crash | escaped | collision | commanded),
`debris-spawn`, `debris-decay`, `collision`, `kessler-cascade`,
`action-blocked` (action: launch | boost | deorbit | select-site),
`site-unlocked`, `coverage-start`, `coverage-gap`, `revenue`, `bankruptcy`,
`game-over` (reason: bankruptcy | kessler), `frame`. All carry `t` (ms since
boot, monotonic). Exact shapes in `src/agent/events.ts`.

Test-harness note: `waitForEvent` returns the FIRST match in the ring buffer —
when a spec fires the same action twice, use `waitForEventAfter(type, sinceT)`.
And `waitFor`'s predicate is stringified and run inside the page, so it cannot
close over Node-side values; pass them via the `arg` parameter.

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

## Shipped layers & roadmap

Shipped, in order: **MVP loop** (launch/decay/boost/coverage/bankruptcy),
**debris + Kessler cascade** (ambient junk, collisions → fragments, cascade
cap, commanded de-orbit), **feel pass** (strategy pacing, HUD legibility,
action-blocked feedback), **trajectory launch** (real Newtonian orbits, the
launch console, atmosphere drag, boost-as-Δv), **bands + sites**
(LEO/MEO/GEO, valuation-unlocked launch pads, altitude/pay trade).

Deferred (do not add without scoping): debris–debris collisions (so a cascade
can self-sustain — today debris attrits the fleet but rarely snowballs),
eclipse/battery, explicit contracts + funding rounds, tech tree, launch
failures, de-orbit tugs. See `perigee-design-brief.md` in the workspace for
the design intent and the two-fail-state tension (bankruptcy vs. Kessler) the
whole game is built around.
