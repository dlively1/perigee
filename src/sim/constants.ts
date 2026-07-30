// Every feel knob lives here so tuning is data, not code buried in the scene.
// Distances are in the game's logical pixels (a 640×640 surface, Earth centered).

export const TUNING = {
  // Geometry
  surface: 640,
  earthRadius: 58,
  ringRadius: 210,

  // Motion (radians per second)
  satOmega: (2 * Math.PI) / 6, // one orbit every 6s
  earthOmega: (2 * Math.PI) / 24, // one ground rotation every 24s

  // Decay & boost — altitude is a 0..1 reserve.
  decayPerSec: 1 / 34, // a neglected sat deorbits in ~34s
  criticalAltitude: 0.25, // below this, emit decay-critical + the sat turns red
  boostAmount: 0.55, // altitude restored per boost
  launchAltitude: 1, // sats insert at full altitude
  insertSeconds: 1.4, // launch → live climb time

  // Coverage — the contract region is a point on the ground; a sat covers it
  // when its ground angle is within ±footprintHalfWidth of the region.
  footprintHalfWidth: (18 * Math.PI) / 180, // ±18°

  // Economy
  startingCash: 500,
  launchCost: 110,
  boostCost: 22,
  coverageRate: 24, // $/s earned while the region is covered

  // Safety rails
  maxSatellites: 10,
} as const;

export type Tuning = typeof TUNING;
