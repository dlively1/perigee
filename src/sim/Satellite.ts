// Satellite state: a physics body in the Earth-centered frame plus lifecycle
// flags. Kept a plain data record (not a Phaser object) so the whole fleet can
// be integrated, inspected, and unit-tested independent of rendering.

import type { BodyState } from "../core/orbit";

export interface Satellite extends BodyState {
  id: number;
  // Ascent animation: while > 0 the rocket is riding the cosmetic pad→burnout
  // arc and is not yet a physical body. Counts down in seconds.
  ascentRemaining: number;
  // Frozen at ignition: where the ascent started and where it ends.
  padX: number;
  padY: number;
  // The physics state to adopt at burnout is already in x/y/vx/vy.
  // Live = achieved a stable orbit (perigee cleared the insert floor).
  live: boolean;
  // Latches when perigee dips below critical so the event fires once per dip.
  critical: boolean;
  // Station-keeping fuel in seconds, and what it launched with. Drains while
  // live; boosts take a chunk. The pad that built it sets `fuelMax`.
  fuel: number;
  fuelMax: number;
  // Fuel ran out: the satellite is DARK. Still in orbit, still a collision
  // hazard, but it earns nothing and can't boost until you de-orbit it.
  expired: boolean;
  // Orbit-raise maneuver: while > 0 the sat is on rails, gliding from
  // raiseFrom to raiseTo on a circular orbit (see circularStep).
  raiseRemaining: number;
  raiseFrom: number;
  raiseTo: number;
  // Cached elements, refreshed each step — read by HUD/snapshot/render.
  perigee: number;
  apogee: number;
}

export function createSatellite(
  id: number,
  burnout: BodyState,
  padX: number,
  padY: number,
  ascentSeconds: number,
  fuelSeconds: number,
): Satellite {
  return {
    id,
    ...burnout,
    ascentRemaining: ascentSeconds,
    padX,
    padY,
    live: false,
    critical: false,
    fuel: fuelSeconds,
    fuelMax: fuelSeconds,
    expired: false,
    raiseRemaining: 0,
    raiseFrom: 0,
    raiseTo: 0,
    perigee: 0,
    apogee: 0,
  };
}
