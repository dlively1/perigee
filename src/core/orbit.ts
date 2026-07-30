// Pure orbital + coverage math. No Phaser, no state — every function here is a
// deterministic transform so it can be unit-tested in milliseconds.
//
// The physics model (since the trajectory-launch rewrite): 2D point gravity
// around Earth at the origin, semi-implicit Euler integration with substeps, a
// linear-density atmosphere that drags anything flying low, and an impulive-ish
// launch: a small initial kick plus a fixed-direction thrust burn, then coast.
// Orbits are real conics — a low perigee means drag on every pass, which is
// where the game gets its name.

export const TWO_PI = Math.PI * 2;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// Normalize an angle to [0, 2π).
export function normalizeAngle(a: number): number {
  const m = a % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

// Smallest signed difference (a − b), in (−π, π].
export function angleDelta(a: number, b: number): number {
  let d = normalizeAngle(a) - normalizeAngle(b);
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

// Advance an orbital angle by ω·dt seconds, normalized.
export function advanceAngle(theta: number, omega: number, dt: number): number {
  return normalizeAngle(theta + omega * dt);
}

// The ground point beneath a satellite shares the satellite's angle. The region
// is covered when its ground angle sits within ±halfWidth of any live sat.
export function isAngleCovered(
  satAngles: readonly number[],
  regionAngle: number,
  halfWidth: number,
): boolean {
  for (const s of satAngles) {
    if (Math.abs(angleDelta(s, regionAngle)) <= halfWidth) return true;
  }
  return false;
}

export function pointOnCircle(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

// ---------------------------------------------------------------------------
// Newtonian core
// ---------------------------------------------------------------------------

// A point mass in the Earth-centered frame (origin = Earth's center).
export interface BodyState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Shape of the atmosphere + drag model, bundled so callers pass one object.
export interface DragModel {
  earthRadius: number;
  // Density falls linearly from 1 at the surface to 0 at this radius.
  ceiling: number;
  // Drag acceleration = k * density(r) * speed, opposing velocity.
  k: number;
}

// Speed of a circular orbit at radius r.
export function circularSpeed(mu: number, r: number): number {
  return Math.sqrt(mu / r);
}

// Linear-density atmosphere: 1 at the surface, 0 at the ceiling and above.
export function airDensity(r: number, model: DragModel): number {
  if (r >= model.ceiling) return 0;
  return clamp01((model.ceiling - r) / (model.ceiling - model.earthRadius));
}

export interface OrbitalElements {
  // Semi-major axis (negative for hyperbolic trajectories).
  a: number;
  // Eccentricity: 0 circular, <1 elliptic, >=1 escape.
  e: number;
  // Periapsis / apoapsis radii (apogee is Infinity when e >= 1).
  perigee: number;
  apogee: number;
  // Specific orbital energy (negative = bound).
  energy: number;
  // Argument of periapsis (angle of the perigee point), radians.
  periapsisAngle: number;
}

// Closed-form conic elements from an instantaneous state. Pure — lets the game
// (and tests) reason about "where is this orbit going" without simulating it.
export function orbitalElements(mu: number, s: BodyState): OrbitalElements {
  const r = Math.hypot(s.x, s.y);
  const v2 = s.vx * s.vx + s.vy * s.vy;
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy);
  // Eccentricity vector: e⃗ = ((v²−μ/r)·r⃗ − (r⃗·v⃗)·v⃗) / μ
  const rv = s.x * s.vx + s.y * s.vy;
  const c = v2 - mu / r;
  const ex = (c * s.x - rv * s.vx) / mu;
  const ey = (c * s.y - rv * s.vy) / mu;
  const e = Math.hypot(ex, ey);
  const perigee = e < 1 ? a * (1 - e) : Math.abs(a) * (e - 1);
  const apogee = e < 1 ? a * (1 + e) : Infinity;
  return { a, e, perigee, apogee, energy, periapsisAngle: Math.atan2(ey, ex) };
}

// One physics step: gravity + optional drag + optional thrust, semi-implicit
// Euler with fixed substeps so high timeScale stays stable. Mutates `s`.
export function stepBody(
  mu: number,
  s: BodyState,
  dt: number,
  drag?: DragModel,
  thrust?: { ax: number; ay: number },
  maxSubDt = 0.016,
): void {
  const steps = Math.max(1, Math.ceil(dt / maxSubDt));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const r = Math.hypot(s.x, s.y);
    const g = -mu / (r * r * r);
    let ax = g * s.x;
    let ay = g * s.y;
    if (drag) {
      const rho = airDensity(r, drag);
      if (rho > 0) {
        ax -= drag.k * rho * s.vx;
        ay -= drag.k * rho * s.vy;
      }
    }
    if (thrust) {
      ax += thrust.ax;
      ay += thrust.ay;
    }
    s.vx += ax * h;
    s.vy += ay * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
  }
}

// The launch abstraction: the ascent itself is animated, not simulated — a
// game-scale Earth has surface gravity no believable rocket thrust could
// fight. Instead the player's aim + power choose the rocket's BURNOUT STATE:
// where the upper stage cuts off at the edge of the atmosphere, how fast it's
// going, and at what flight-path angle. Everything after burnout is honest
// physics. Power = apogee (how high the orbit reaches); aim = perigee health
// (tangential is ideal; lofted or dipped burns drop the perigee into drag).
//
// `siteAngle` is the pad's screen angle at ignition; the burnout point sits
// `downrange` radians prograde of it. `fpa` is the flight-path angle in
// radians (0 = tangential/prograde, positive = outward). The stage inherits
// the ground's rotation speed, so launching prograde is slightly cheaper.
export function burnoutState(
  siteAngle: number,
  downrange: number,
  radius: number,
  speed: number,
  fpa: number,
  earthOmega: number,
): BodyState {
  const a = siteAngle + downrange;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Local frame at the burnout point: up = (ux, uy), prograde = (-uy, ux).
  const tx = -uy;
  const ty = ux;
  const vdirX = tx * Math.cos(fpa) + ux * Math.sin(fpa);
  const vdirY = ty * Math.cos(fpa) + uy * Math.sin(fpa);
  const spin = earthOmega * radius;
  return {
    x: ux * radius,
    y: uy * radius,
    vx: vdirX * speed + tx * spin,
    vy: vdirY * speed + ty * spin,
  };
}

// One frame of a scripted orbit-raise. The body glides along a circular orbit
// of `targetRadius`, advancing at that orbit's angular rate and keeping its
// direction of travel. Deliberately NOT a physical impulse: a real prograde
// burn raises only the opposite side of the orbit, which reads as "my
// satellite flew off somewhere weird". This keeps boosting legible — the
// satellite simply moves up — while launch stays honest physics.
export function circularStep(
  s: BodyState,
  mu: number,
  targetRadius: number,
  dt: number,
): BodyState {
  const angle = Math.atan2(s.y, s.x);
  // Sign of angular momentum tells us which way it's going round.
  const dir = s.x * s.vy - s.y * s.vx >= 0 ? 1 : -1;
  const v = circularSpeed(mu, targetRadius);
  const a = angle + (v / targetRadius) * dir * dt;
  return {
    x: targetRadius * Math.cos(a),
    y: targetRadius * Math.sin(a),
    vx: -Math.sin(a) * v * dir,
    vy: Math.cos(a) * v * dir,
  };
}

export type PredictOutcome = "flying" | "crashed" | "escaped";

export interface Prediction {
  points: { x: number; y: number }[];
  outcome: PredictOutcome;
}

// Coast a state forward (gravity + drag, no thrust) and sample the path. Used
// by the launch console for the live trajectory preview and by tests — the
// same integrator the sim runs, so the preview is exactly what will happen,
// including drag spiraling a low perigee inward.
export function predictPath(
  mu: number,
  start: BodyState,
  drag: DragModel,
  horizonSeconds: number,
  escapeRadius: number,
  sampleEvery = 4,
  stepDt = 0.016,
): Prediction {
  const s: BodyState = { ...start };
  const points: { x: number; y: number }[] = [];
  const steps = Math.ceil(horizonSeconds / stepDt);
  for (let i = 0; i < steps; i++) {
    stepBody(mu, s, stepDt, drag, undefined, stepDt);
    if (i % sampleEvery === 0) points.push({ x: s.x, y: s.y });
    const r = Math.hypot(s.x, s.y);
    if (r <= drag.earthRadius) return { points, outcome: "crashed" };
    if (r > escapeRadius) return { points, outcome: "escaped" };
  }
  return { points, outcome: "flying" };
}

// A quadratic-bezier ascent arc from the pad to the burnout point — purely
// cosmetic (the rocket rides this curve while "climbing"), but shared so both
// the scene and tests agree on where the rocket is mid-ascent.
export function ascentPoint(
  padX: number,
  padY: number,
  burnX: number,
  burnY: number,
  t: number,
): { x: number; y: number } {
  // Control point: lifted radially off the pad so the arc leaves vertically.
  const lift = 1.55;
  const cx = padX * lift;
  const cy = padY * lift;
  const u = 1 - t;
  return {
    x: u * u * padX + 2 * u * t * cx + t * t * burnX,
    y: u * u * padY + 2 * u * t * cy + t * t * burnY,
  };
}
