# 🛰️ Perigee

> Strategy game about keeping a satellite constellation alive — real orbits,
> real drag, and two ways to lose.

You run a scrappy space-internet company. **Launch** rockets from your pad into
real Newtonian orbits, earn revenue by holding **coverage** over contracted
ground markets, and fight the atmosphere: any orbit whose **perigee** dips low
gets dragged down a little on every pass. **Boost** them back up to keep birds
alive, **de-orbit** dying ones cleanly before they become junk. Let cash hit zero
and you're bankrupt; let debris pile up and a **Kessler cascade** graveyards
the sky. Your score is your company's **valuation**.

Built with **Phaser 3** + **TypeScript**, and 100% procedural art — no image or
audio files anywhere in the repo.

## Launching (the fun part)

Press `L` to open the launch console, then aim with the arrow keys — you're
choosing the upper stage's burnout state, and the dotted line shows exactly
where that orbit goes (drag included):

- **Power (↑↓)** sets insertion speed → how high the far side (apogee) reaches.
- **Aim (←→)** sets the flight-path angle → tangential (0°) keeps the perigee
  healthy; lofted or dipped burns drop it into the atmosphere.

Launching prograde (with Earth's spin) is slightly cheaper. Just like home.

Once a satellite is up, **`B` boosts it**: it glides onto a circular orbit a
step higher. That's the maintenance move against drag — simple and
predictable, no orbital-mechanics degree required. What a boost _can't_ do is
lift a satellite into a higher band; getting to MEO or GEO means launching
there from a pad that can throw that hard.

## Nothing stays up forever

Every satellite launches with a tank of station-keeping fuel — the little bar
under it — and burns it just by working. **Boosting costs a chunk of it**, so
fighting drag in LEO literally spends your bird's working life.

When the tank hits zero it goes **dark**: still in orbit, still big enough to
kill something, but earning nothing. Press **`D`** to de-orbit it cleanly for
pocket change, or leave it up there and let it become somebody's debris.

So a fleet ages, and a fleet you launched all at once dies all at once. High
orbits never need boosting, which means they spend none of their life fighting
the atmosphere — another quiet reason to climb.

## Growing the company

**Cash operates, valuation unlocks.** Revenue pays both: cash funds launches
and boosts, while valuation (your cumulative earnings — the score) buys
progress. It alternates between two kinds:

- **Launch pads** — reach higher, and build better. Your starter pad can barely
  make LEO; later pads lift the power ceiling until you can throw a GEO
  transfer, _and_ turn out satellites that stay useful much longer.
- **Contract regions** — serve more. Each market you sign pays its own $/s
  while a satellite is over it, and they **add up**.

Those two pull against each other, because altitude is a trade:

| Band    | Drag & debris     | Footprint | Pays      |
| ------- | ----------------- | --------- | --------- |
| **LEO** | decays, congested | narrow    | full rate |
| **MEO** | clear             | wider     | 70%       |
| **GEO** | clear             | widest    | 45%       |

Low orbits print money but need constant boosting and share the sky with junk.
High orbits run themselves but pay less — so why ever go up?

**Because of where the markets sit.** One satellite serves one place at a time,
so income scales with how well your fleet is _spread_, not how big it is. And
two of the three markets sit close enough together that a wide high-orbit
footprint can straddle **both at once** — one bird doing two markets' work.
That's what buys back the lower rate. A LEO bird parked between them reaches
neither and has to pick a side.

A good constellation mixes both — and the only way up is to earn your way there.

## Controls

| Input             | Action                                           |
| ----------------- | ------------------------------------------------ |
| `L`               | Open / close the launch console                  |
| `←` `→`           | Aim (flight-path angle)                          |
| `↑` `↓`           | Power (insertion speed)                          |
| `Enter`           | Fire ($110)                                      |
| `1` `2` `3`       | Pick a launch pad (once unlocked)                |
| `Tab`             | Cycle unlocked pads                              |
| `Esc`             | Close the console                                |
| Click a satellite | Select it (shows its predicted path)             |
| `B`               | Boost the selected sat (else the lowest perigee) |
| `D`               | De-orbit cleanly (else the first dark sat)       |
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
