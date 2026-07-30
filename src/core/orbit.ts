// Pure orbital + coverage math. No Phaser, no state — every function here is a
// deterministic transform so it can be unit-tested in milliseconds.

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

// Altitude is a 0..1 reserve: decay drains it linearly, boost tops it up.
export function decayAltitude(alt: number, ratePerSec: number, dt: number): number {
  return Math.max(0, alt - ratePerSec * dt);
}

export function boostAltitude(alt: number, amount: number): number {
  return Math.min(1, alt + amount);
}

// Visual orbit radius: full altitude sits the sat on the ring; as altitude
// decays it spirals inward toward Earth. innerFactor is where alt=0 sits,
// as a fraction of the ring radius.
export function orbitRadius(ringRadius: number, alt: number, innerFactor = 0.6): number {
  return ringRadius * (innerFactor + (1 - innerFactor) * clamp01(alt));
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
