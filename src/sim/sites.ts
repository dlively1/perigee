// Launch sites are data, and a better site buys TWO things — that's the
// progression: valuation (company worth) unlocks sites, sites build the fleet.
//
//   1. Reach — `maxPower` caps the console's power dial. Values come from the
//      calibrated envelope: ~0.32 tops out around LEO, ~0.55 buys MEO
//      transfers, 1.0 reaches GEO transfers (and overshoots to escape if
//      you're careless).
//   2. Better satellites — `fuelSeconds` is the service life of the birds this
//      pad builds. A bigger pad integrates a bigger spacecraft, so its
//      satellites work longer before going dark. Upgrading isn't just about
//      altitude; it's about not replacing your fleet as often.

export interface SiteDef {
  id: string;
  name: string;
  // Fixed in the Earth frame; the pad rotates with the planet.
  angle: number;
  // Caps the launch console's power dial (0..1).
  maxPower: number;
  // Seconds of station-keeping the satellites built here carry (see
  // TUNING.fuelDrainPerSec / boostFuel). Boosting spends this too.
  fuelSeconds: number;
  // Auto-unlocks when valuation reaches this.
  unlockValuation: number;
}

export const SITES: readonly SiteDef[] = [
  {
    id: "mojave",
    name: "Mojave Flats",
    angle: -Math.PI / 2,
    maxPower: 0.32,
    fuelSeconds: 120,
    unlockValuation: 0,
  },
  {
    id: "canaveral",
    name: "Cape Canaveral",
    angle: 0.7,
    maxPower: 0.55,
    fuelSeconds: 200,
    unlockValuation: 900,
  },
  {
    id: "equatorial",
    name: "Equatorial Spaceport",
    angle: 2.6,
    maxPower: 1.0,
    fuelSeconds: 300,
    unlockValuation: 2400,
  },
] as const;

export function siteById(id: string): SiteDef | undefined {
  return SITES.find((s) => s.id === id);
}

export function sitesUnlockedFor(valuation: number): SiteDef[] {
  return SITES.filter((s) => valuation >= s.unlockValuation);
}
