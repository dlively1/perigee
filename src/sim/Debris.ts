// Debris state: a physics body like a satellite, but it earns nothing, cannot
// be boosted, and self-cleans only when drag drags its perigee into the
// atmosphere. Fragments from collisions inherit scattered velocities, so some
// re-enter quickly and some persist — that spread is the Kessler texture.

import type { BodyState } from "../core/orbit";

export type DebrisSource = "ambient" | "collision" | "cheat";

export interface Debris extends BodyState {
  id: number;
  source: DebrisSource;
}

export function createDebris(id: number, state: BodyState, source: DebrisSource): Debris {
  return { id, ...state, source };
}
