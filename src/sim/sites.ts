// Launch sites are data. Better sites cap the power dial higher — that's the
// progression: valuation (company worth) unlocks sites, sites reach bands.
// maxPower values come from the calibrated envelope: ~0.32 tops out around
// LEO, ~0.55 buys MEO transfers, 1.0 reaches GEO transfers (and can overshoot
// to escape if you're careless).

export interface SiteDef {
  id: string;
  name: string;
  // Fixed in the Earth frame; the pad rotates with the planet.
  angle: number;
  // Caps the launch console's power dial (0..1).
  maxPower: number;
  // Auto-unlocks when valuation reaches this.
  unlockValuation: number;
}

export const SITES: readonly SiteDef[] = [
  {
    id: "mojave",
    name: "Mojave Flats",
    angle: -Math.PI / 2,
    maxPower: 0.32,
    unlockValuation: 0,
  },
  {
    id: "canaveral",
    name: "Cape Canaveral",
    angle: 0.7,
    maxPower: 0.55,
    unlockValuation: 900,
  },
  {
    id: "equatorial",
    name: "Equatorial Spaceport",
    angle: 2.6,
    maxPower: 1.0,
    unlockValuation: 2400,
  },
] as const;

export function siteById(id: string): SiteDef | undefined {
  return SITES.find((s) => s.id === id);
}

export function sitesUnlockedFor(valuation: number): SiteDef[] {
  return SITES.filter((s) => valuation >= s.unlockValuation);
}
