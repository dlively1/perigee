# 🛰️ Perigee

> Soft-real-time satellite-startup game — launch them, keep them up, and don't
> go broke doing it.

You run a scrappy space-internet company. Launch satellites onto an orbital
ring, fight the constant tug of **orbital decay** by spending to **boost** them,
and earn revenue by holding **coverage** over a contracted ground region that
rotates with the Earth. Cash is your **runway**; let it hit zero and you're
bankrupt. Your score is your company's **valuation**.

Built with **Phaser 3** + **TypeScript**, 100% procedural art (no image or audio
files anywhere in the repo), and a seeded RNG so a given seed plays out the same
on any machine.

## This is the MVP

The first playable slice proves one thing: _is keeping 2–3 satellites alive and
phased against decay — without boosting yourself broke — fun on its own?_ It's
one orbit ring with five verbs' worth of loop: **launch, decay, boost, earn
coverage, go bankrupt.** Debris/Kessler, eclipses, multiple orbits, and the
funding-round meta are deliberately deferred (see [`CLAUDE.md`](./CLAUDE.md)).

## Controls

| Input             | Action                                      |
| ----------------- | ------------------------------------------- |
| Click empty ring  | Launch a satellite inserting at that angle  |
| Click a satellite | Select it                                   |
| `B`               | Boost the selected sat (or the most urgent) |
| `L`               | Launch at the current pointer angle         |
| `Space`           | Pause / resume (you can still issue orders) |
| Click / `Space`   | Start (menu) · Restart (after bankruptcy)   |

## Run it locally

Requires [pnpm](https://pnpm.io) and Node (see `.nvmrc`).

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173.

## Handy URL params

```
http://localhost:5173/?seed=42&autoplay=1&timeScale=4
```

| Param       | What it does                         |
| ----------- | ------------------------------------ |
| `seed`      | Seed the deterministic RNG.          |
| `autoplay`  | Skip the menu and start immediately. |
| `paused`    | Boot paused (handy for screenshots). |
| `timeScale` | Run the sim 1–8× faster.             |

## Tests

```bash
pnpm test:unit      # Vitest — pure sim logic (fast)
pnpm test:install   # one-time: Playwright chromium
pnpm test           # Playwright e2e against a real build
pnpm typecheck      # tsc --noEmit
```

A deeper tour of the architecture and the agent bridge (`window.__PERIGEE`)
lives in [`CLAUDE.md`](./CLAUDE.md).
