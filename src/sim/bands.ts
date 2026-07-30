// Orbit bands are data. Higher bands are safer (no drag, no ambient junk) and
// see more ground, but pay less per second — satellite internet from high
// orbit means high latency, so contracts pay a fraction of the LEO rate.
// Classification is by current radius, so an eccentric orbit can dip through
// bands — its coverage pays whatever band it's in right now.

export type BandId = "LEO" | "MEO" | "GEO";

export interface BandDef {
  id: BandId;
  label: string;
  // Nominal display radius for the guide ring.
  radius: number;
  // Classification range [min, max).
  min: number;
  max: number;
  // Revenue multiplier while a sat in this band holds coverage.
  rateMult: number;
}

export const BANDS: readonly BandDef[] = [
  { id: "LEO", label: "LEO", radius: 130, min: 0, max: 180, rateMult: 1 },
  { id: "MEO", label: "MEO", radius: 220, min: 180, max: 265, rateMult: 0.7 },
  { id: "GEO", label: "GEO", radius: 300, min: 265, max: Infinity, rateMult: 0.45 },
] as const;

export function bandFor(r: number): BandDef {
  for (const b of BANDS) {
    if (r >= b.min && r < b.max) return b;
  }
  return BANDS[BANDS.length - 1];
}

export function rateMultiplier(r: number): number {
  return bandFor(r).rateMult;
}

// A higher satellite sees more ground: its coverage window widens with radius,
// linearly from the LEO baseline, capped so GEO can't blanket half the planet.
export function footprintHalfWidthFor(r: number, baseHalfWidth: number): number {
  return baseHalfWidth * Math.min(1.8, Math.max(1, r / 130));
}
