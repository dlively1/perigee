# 🛰️ Perigee

> Strategy game about keeping a satellite constellation alive — real orbits,
> real drag, and two ways to lose.

You run a scrappy space-internet company. **Launch** rockets from your pad into
real Newtonian orbits, earn revenue by holding **coverage** over a contracted
ground region, and fight the atmosphere: any orbit whose **perigee** dips low
gets dragged down a little on every pass. **Boost** (prograde Δv) to keep birds
up, **de-orbit** dying ones cleanly before they become junk. Let cash hit zero
and you're bankrupt; let debris pile up and a **Kessler cascade** graveyards
the sky. Your score is your company's **valuation**.

Built with **Phaser 3** + **TypeScript**, 100% procedural art (no image or
audio files anywhere in the repo), and a seeded RNG so a given seed plays out
the same on any machine.

## Launching (the fun part)

Press `L` to open the launch console, then aim with the arrow keys — you're
choosing the upper stage's burnout state, and the dotted line shows exactly
where that orbit goes (drag included):

- **Power (↑↓)** sets insertion speed → how high the far side (apogee) reaches.
- **Aim (←→)** sets the flight-path angle → tangential (0°) keeps the perigee
  healthy; lofted or dipped burns drop it into the atmosphere.
- Low orbits are cheap but decay; high orbits are safe but cost more to reach:
  launch a transfer ellipse, coast to apogee, then **boost there** to raise
  your perigee out of the drag. (A prograde boost raises the _opposite_ side
  of your orbit — that's real orbital mechanics, and it's the core skill.)

Launching prograde (with Earth's spin) is slightly cheaper. Just like home.

## Controls

| Input             | Action                                           |
| ----------------- | ------------------------------------------------ |
| `L`               | Open / close the launch console                  |
| `←` `→`           | Aim (flight-path angle)                          |
| `↑` `↓`           | Power (insertion speed)                          |
| `Enter`           | Fire ($110)                                      |
| `Esc`             | Close the console                                |
| Click a satellite | Select it (shows its predicted path)             |
| `B`               | Boost the selected sat (else the lowest perigee) |
| `D`               | De-orbit cleanly — no debris                     |
| `Space`           | Pause / resume (the console works while paused)  |
| Click / `Space`   | Start (menu) · Restart (after game over)         |

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
| `debris`    | `0` disables ambient junk.           |
| `timeScale` | Run the sim 1–8× faster.             |

## Tests

```bash
pnpm test:unit      # Vitest — pure orbital physics + economy (fast)
pnpm test:install   # one-time: Playwright chromium
pnpm test           # Playwright e2e against a real build
pnpm typecheck      # tsc --noEmit
```

A deeper tour of the architecture, the physics model, and the agent bridge
(`window.__PERIGEE`) lives in [`CLAUDE.md`](./CLAUDE.md).
