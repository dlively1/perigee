// Debris state. Like a satellite it orbits and loses altitude, but it earns
// nothing, cannot be boosted, orbits at its own (faster) angular speed so it
// sweeps through the constellation, and burns up when its altitude hits zero.

export type DebrisSource = "ambient" | "collision" | "cheat";

export interface Debris {
  id: number;
  angle: number;
  // Altitude reserve, 0..1. Debris decays faster than sats and burns up at 0.
  alt: number;
  // Angular velocity (rad/s) — signed, and distinct from the constellation's,
  // so debris drifts relative to live sats and can catch them.
  omega: number;
  source: DebrisSource;
}

export function createDebris(
  id: number,
  angle: number,
  alt: number,
  omega: number,
  source: DebrisSource,
): Debris {
  return { id, angle, alt, omega, source };
}
