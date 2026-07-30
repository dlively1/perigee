// Every feel knob lives here so tuning is data, not code buried in the scene.
// Distances are in the game's logical pixels (a 640×640 surface, Earth centered).

export const TUNING = {
  // Geometry
  surface: 640,
  earthRadius: 58,
  ringRadius: 210,

  // Motion (radians per second). Deliberately unhurried — Perigee is a
  // strategy game with real-time pressure, not a twitch arcade loop.
  satOmega: (2 * Math.PI) / 9, // one orbit every 9s
  earthOmega: (2 * Math.PI) / 36, // one ground rotation every 36s

  // Decay & boost — altitude is a 0..1 reserve.
  decayPerSec: 1 / 75, // a neglected sat deorbits in ~75s
  criticalAltitude: 0.25, // below this, emit decay-critical + the sat turns red
  boostAmount: 0.55, // altitude restored per boost
  launchAltitude: 1, // sats insert at full altitude
  insertSeconds: 1.8, // launch → live climb time

  // Coverage — the contract region is a point on the ground; a sat covers it
  // when its ground angle is within ±footprintHalfWidth of the region.
  footprintHalfWidth: (18 * Math.PI) / 180, // ±18°
  // Brief footprint gaps (a sat handing off to the next) don't cut revenue —
  // coverage lingers this long after the last sat rotates off the region.
  coverageGraceSec: 0.8,

  // Economy
  startingCash: 650,
  launchCost: 110,
  boostCost: 22,
  coverageRate: 20, // $/s earned while the region is covered
  deorbitCost: 8, // commanded, clean removal — cheaper than a boost

  // Debris & Kessler cascade.
  // Debris orbits faster than the constellation so it sweeps through the sat
  // field; that relative motion is what makes collisions possible on one ring.
  debrisOmegaFactor: 1.45,
  debrisDecayPerSec: 1 / 20, // debris re-enters and burns up in ~20s (relief valve)
  // Ambient (external) junk — spent stages, ASAT tests, rivals' dead birds —
  // arrives on a seeded schedule. This is the seed that starts a cascade.
  // Kept rare: debris should be a looming strategic threat, not early attrition.
  ambientFirstSec: 45, // no external debris before this
  ambientMinGapSec: 25,
  ambientMaxGapSec: 45,
  // A live sat and a debris collide when close in BOTH angle and altitude.
  collisionAngle: (5 * Math.PI) / 180, // ±5°
  collisionRadius: 12, // px in altitude/radius
  fragmentsPerCollision: 3, // net +2 debris per hit (one consumed, three born)
  kesslerCap: 26, // debris count at which the ring cascades → game over

  // Safety rails
  maxSatellites: 10,
  maxDebris: 60, // hard render/logic cap (cascade ends the run well before this)
} as const;

export type Tuning = typeof TUNING;
