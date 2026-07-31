// Contract regions are the ground markets you're paid to serve. Each is a fixed
// point on the planet (so it rotates with Earth) that a satellite covers when
// its footprint arc contains the region's ground angle.
//
// Why more than one: with a single market, every orbit is interchangeable and
// the bands are a strict downgrade — MEO/GEO pay less and buy nothing. Multiple
// markets make constellation GEOMETRY the game. One satellite can only serve
// one place at a time, so revenue scales with how well the fleet is SPREAD, and
// a high orbit's wide footprint finally has something to buy.
//
// The angles below are deliberate, not decorative:
//   - `pacific` sits far from the other two, so serving it means a genuinely
//     separate satellite — it is the "spread your fleet" market.
//   - `gulf` and `atlantic` are a TWIN PAIR ~0.85 rad apart. A LEO footprint
//     (±~21°, i.e. ~0.72 rad wide) cannot span that gap, but a MEO/GEO
//     footprint (±~31°, ~1.06 rad wide) can straddle both at once. That is the
//     concrete payoff for climbing: one high bird doing two markets' work,
//     which is what makes the reduced high-band rate worth paying.
// See the straddle test in tests/unit/progression.test.ts — it pins this.
//
// Regions unlock on valuation, interleaved with the launch sites (0 / 900 /
// 2400) so the company alternates between "reach higher" and "serve more".

export interface RegionDef {
  id: string;
  name: string;
  // Ground angle in the Earth frame; the region rotates with the planet.
  angle: number;
  // Base $/s while covered, before the serving satellite's band multiplier.
  payRate: number;
  // Auto-signs when valuation reaches this.
  unlockValuation: number;
}

export const REGIONS: readonly RegionDef[] = [
  {
    id: "gulf",
    name: "Gulf Coast",
    angle: 0,
    payRate: 20,
    unlockValuation: 0,
  },
  {
    id: "pacific",
    name: "Pacific Basin",
    angle: 3.6,
    payRate: 20,
    unlockValuation: 500,
  },
  {
    id: "atlantic",
    name: "Atlantic Rim",
    angle: 0.85,
    payRate: 20,
    unlockValuation: 1600,
  },
] as const;

export function regionById(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function regionsUnlockedFor(valuation: number): RegionDef[] {
  return REGIONS.filter((r) => valuation >= r.unlockValuation);
}

// Total $/s on the table once every contract is signed and every market is
// covered by a full-rate (LEO) satellite — the theoretical ceiling.
export function maxIncome(): number {
  return REGIONS.reduce((sum, r) => sum + r.payRate, 0);
}
