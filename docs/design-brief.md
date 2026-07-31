# Perigee — Design Brief

_Working title (alt: "Bootstrap"). One-page brief, v0.1 — 2026-07-29._

> **Historical document — the original design intent, kept for the "why".**
> The core (two fail states in tension, coverage revenue, cash vs. valuation)
> still holds and is worth reading. The specifics have since moved on: the
> MVP's abstract ring became real Newtonian orbits with a trajectory launch
> console, and LEO/MEO/GEO bands plus valuation-unlocked launch pads shipped.
> **[`CLAUDE.md`](../CLAUDE.md) is the current spec** — trust it over this
> file wherever they disagree.

## The pitch

You're a scrappy satellite-internet startup. Launch satellites onto orbital rings around a
rotating Earth, and fight to **keep them up**. You earn by holding coverage over contracted
ground regions; you die by going broke or by trashing the sky you depend on. Your score is
your company's **valuation**.

## Core fantasy & the central tension

Scrappy-startup underdog. The whole game is the pull between two failure states:

- **Bankruptcy** — runway hits $0. Punishes over-caution and over-spending on boosts.
- **Kessler cascade** — debris begets debris; enough on a ring chain-reacts and graveyards
  that orbit. Punishes reckless growth.

_Launch cheap and fast to make runway, but every corner you cut pollutes the sky you rely on._
That tension is the game, not a skin on it.

## How it plays

Soft real-time, FTL-style: runs continuously, but you can **pause/slow** to issue orders and it
auto-slows in a crisis. Top-down view: Earth center, concentric rings (LEO / MEO / GEO).

**Moment-to-moment (the juggle).** Every live sat quietly loses **altitude** (drag; fast when
low) and **battery** (drains in Earth's shadow cone, recharges in sun). Your verbs are physical
and few:

- **Launch** — pick a ring, pay; a rocket inserts a sat (cheap rocket = higher failure chance → creates debris).
- **Boost** — spend to shove a sinking sat back up. The satisfying "catch."
- **De-orbit** — retire a dying sat _before_ it dies and becomes debris. Costs money, protects the sky.

**Meta (the startup).** Contracts ask for a region held for a duration → pay $/sec while served.
Revenue is **sustained coverage**: a pure geometric function of where your live sats are, so
holding a region needs multiple sats **phased** around the ring. Revenue milestones trigger
**funding rounds** (Series A/B) that unlock bigger budgets, higher orbits, and tech: reusable
boosters (cheaper launches), debris tracking, hardened sats, de-orbit tugs. Soft-win: reach
$1B valuation (unicorn), then chase a high score.

## MVP — the first playable slice

One ring. Proves the core juggle before any depth is layered on.

- **In:** launch, altitude decay, boost, sustained-coverage revenue, lose-on-bankruptcy.
- **Out (deferred):** debris/Kessler, eclipse/battery, multiple rings, tech tree, funding
  rounds, rocket failures, de-orbit.
- **Question it answers:** is "keep 2–3 sats alive and phased against decay, without boosting
  yourself broke" fun on its own? If yes, everything else is additive.

**Proposed defaults (all data-driven, tune later):** footprint ±15° arc; contract region rotates
with Earth; controls mouse-first (click gap = launch, click sat = select, `B` = boost,
`Space` = pause); tempo ~5s orbit / ~20s Earth rotation / ~35s to deorbit unboosted.

## Build approach

Mirror the spacemelon architecture directly (Phaser 3 + TypeScript + Vite + Playwright):

- **Every meaningful state change emits a typed event** on a `window.__PERIGEE` bridge, with a
  snapshot + headless input + `waitFor()` — so an agent (or Playwright) plays and verifies it
  headlessly. Events: `launch`, `insert`, `boost`, `decay-critical`, `coverage-start/gap`,
  `revenue`, `contract-offered/fulfilled/dropped`, `funding-round`, `bankruptcy` (+ later:
  `collision`, `debris-spawn`, `cascade`, `eclipse-enter/exit`).
- **Seeded-deterministic** — decay, orbits, eclipse, coverage are pure math off the seed.
- **Data-driven registries** — orbits, contracts, tech upgrades, hazards (spacemelon's
  worlds/abilities/levels pattern, renamed).
- **100% procedural 2D art** — circles, rings, dots, arcs. No asset binaries.

## Open thread

Coverage-geometry / phasing is the mechanic that most shapes how the game _feels to play_ —
worth pressure-testing before building beyond the MVP.
