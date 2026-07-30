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
): Satellite {
  return {
    id,
    ...burnout,
    ascentRemaining: ascentSeconds,
    padX,
    padY,
    live: false,
    critical: false,
    perigee: 0,
    apogee: 0,
  };
}
