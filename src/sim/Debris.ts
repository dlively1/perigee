// Debris state: a physics body like a satellite, but it earns nothing, cannot
// be boosted, and self-cleans only when drag drags its perigee into the
// atmosphere. Fragments from collisions inherit scattered velocities, so some
// re-enter quickly and some persist — that spread is the Kessler texture.

import type { BodyState } from "../core/orbit";

export type DebrisSource = "ambient" | "collision" | "cheat";

export interface Debris extends BodyState {
  id: number;
  source: DebrisSource;
  // Seconds of collision immunity remaining. Fragments are born clustered
  // around the impact point, well inside collision range of each other — with
  // no settling window they re-collide on the very next frame and chain-react
  // into an instant cascade. This gives them time to disperse first.
  settleRemaining: number;
}

export function createDebris(
  id: number,
  state: BodyState,
  source: DebrisSource,
  settleSeconds = 0,
): Debris {
  return { id, ...state, source, settleRemaining: settleSeconds };
}
