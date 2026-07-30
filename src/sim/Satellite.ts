// Plain satellite state. The scene owns an array of these and steps them each
// frame; keeping it a data record (not a Phaser object) means the whole fleet
// can be reasoned about and, later, unit-tested independent of rendering.

export interface Satellite {
  id: number;
  // Current orbital angle in radians.
  angle: number;
  // Altitude reserve, 0..1. Drains via decay, tops up via boost, deorbits at 0.
  alt: number;
  // While a rocket is still climbing, the sat is not yet live (no coverage).
  live: boolean;
  // Seconds remaining before insertion completes (climbing rockets only).
  insertRemaining: number;
  // Latches true when altitude dips below the critical threshold so the
  // decay-critical event fires once per dip, not every frame.
  critical: boolean;
}

export function createSatellite(
  id: number,
  angle: number,
  alt: number,
  insertSeconds: number,
): Satellite {
  return {
    id,
    angle,
    alt,
    live: false,
    insertRemaining: insertSeconds,
    critical: false,
  };
}
