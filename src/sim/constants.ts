// Every feel knob lives here so tuning is data, not code buried in the scene.
// Distances are in the game's logical pixels (a 640×640 surface, Earth at the
// center = the gravity origin), times in seconds, speeds in px/s.

export const TUNING = {
  // Geometry
  surface: 640,
  earthRadius: 58,

  // Gravity. Chosen so a circular LEO orbit (r≈150) has a ~8.5s period —
  // the pacing the first playtest signed off on.
  mu: 1.84e6,

  // Earth day (radians per second) — the contract region rotates at this rate.
  earthOmega: (2 * Math.PI) / 36,

  // Atmosphere: density falls linearly from the surface to the ceiling.
  // Anything below the ceiling feels drag on every pass — a low perigee decays.
  // LEO deliberately sits inside the thin upper tail: LEO sats need periodic
  // boosts; orbits above the ceiling coast for free.
  atmosphereCeiling: 140,
  dragK: 0.012,

  // Launch: the ascent is animated; aim + power pick the upper stage's BURNOUT
  // STATE at the edge of the atmosphere. Power sets the insertion speed
  // (→ apogee); aim sets the flight-path angle (0 = tangential = healthy
  // perigee; lofted/dipped burns drop the perigee into drag).
  launch: {
    burnoutRadius: 125,
    ascentSeconds: 1.6,
    downrangeRad: 0.35, // burnout point sits this far prograde of the pad
    minSpeed: 90, // suborbital lob
    maxSpeed: 150, // escape flirts in at the very top of the dial
    fpaMinDeg: -30,
    fpaMaxDeg: 30,
  },

  // A burnout orbit counts as "inserted" (sat goes live) once its perigee
  // clears this radius — i.e. it's a real orbit, not a doomed lob.
  insertFloor: 110,
  // Below this perigee a live sat is visibly dying — decay-critical fires.
  criticalPerigee: 100,
  // Prograde Δv per boost. Raises the far side of the orbit — boosting at
  // apogee is how you lift a transfer ellipse's perigee out of the drag.
  boostDv: 26,
  // Beyond this radius a body is gone for good ("escaped").
  escapeRadius: 1400,

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

  // Debris & Kessler cascade. Ambient junk arrives on a seeded schedule into
  // the congested low band; collisions shatter into fragments. Kept rare:
  // debris is a looming strategic threat, not early attrition.
  ambientFirstSec: 45,
  ambientMinGapSec: 25,
  ambientMaxGapSec: 45,
  // Ambient junk spawns on near-circular orbits in this radius range (LEO).
  ambientRadiusMin: 120,
  ambientRadiusMax: 155,
  ambientSpeedJitter: 0.1, // ± fraction of circular speed
  // A live sat and a debris collide inside this distance (px).
  collisionDist: 10,
  fragmentsPerCollision: 3,
  fragmentSpeedJitter: 30, // px/s scatter added to fragments
  kesslerCap: 26, // debris count at which the ring cascades → game over

  // Safety rails
  maxSatellites: 10,
  maxDebris: 60, // hard render/logic cap (cascade ends the run well before this)
} as const;

export type Tuning = typeof TUNING;

// The drag model in the shape src/core/orbit.ts expects.
export const DRAG = {
  earthRadius: TUNING.earthRadius,
  ceiling: TUNING.atmosphereCeiling,
  k: TUNING.dragK,
} as const;
