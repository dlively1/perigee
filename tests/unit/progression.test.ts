import { describe, expect, it } from "vitest";
import { BANDS, bandFor, footprintHalfWidthFor, rateMultiplier } from "../../src/sim/bands";
import { SITES, siteById, sitesUnlockedFor } from "../../src/sim/sites";
import { REGIONS, maxIncome, regionById, regionsUnlockedFor } from "../../src/sim/regions";
import { TUNING } from "../../src/sim/constants";
import { angleDelta } from "../../src/core/orbit";

describe("orbit bands", () => {
  it("classifies by radius", () => {
    expect(bandFor(130).id).toBe("LEO");
    expect(bandFor(220).id).toBe("MEO");
    expect(bandFor(400).id).toBe("GEO");
  });

  it("covers every radius with no gaps", () => {
    for (let r = 0; r < 600; r += 7) expect(bandFor(r)).toBeDefined();
  });

  it("pays less the higher you go — the latency trade", () => {
    expect(rateMultiplier(130)).toBeGreaterThan(rateMultiplier(220));
    expect(rateMultiplier(220)).toBeGreaterThan(rateMultiplier(400));
  });

  it("gives higher orbits a wider footprint, capped", () => {
    const base = 0.3;
    expect(footprintHalfWidthFor(130, base)).toBeCloseTo(base);
    expect(footprintHalfWidthFor(260, base)).toBeGreaterThan(base);
    // Never wider than the cap, however far out you go.
    expect(footprintHalfWidthFor(5000, base)).toBeCloseTo(base * 1.8);
  });

  it("bands ascend in radius", () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].radius).toBeGreaterThan(BANDS[i - 1].radius);
    }
  });
});

describe("launch sites", () => {
  it("starts with exactly one free site", () => {
    const open = sitesUnlockedFor(0);
    expect(open).toHaveLength(1);
    expect(open[0].unlockValuation).toBe(0);
  });

  it("unlocks progressively with valuation", () => {
    const counts = [0, 1000, 3000].map((v) => sitesUnlockedFor(v).length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBe(SITES.length);
  });

  it("better sites lift the power ceiling", () => {
    const byUnlock = [...SITES].sort((a, b) => a.unlockValuation - b.unlockValuation);
    for (let i = 1; i < byUnlock.length; i++) {
      expect(byUnlock[i].maxPower).toBeGreaterThan(byUnlock[i - 1].maxPower);
    }
  });

  it("better sites also build longer-lived satellites", () => {
    // The second half of a site upgrade: not just reach, but birds that stay
    // useful longer. Both curves must climb together or upgrading reads as a
    // pure altitude choice again.
    const byUnlock = [...SITES].sort((a, b) => a.unlockValuation - b.unlockValuation);
    for (let i = 1; i < byUnlock.length; i++) {
      expect(byUnlock[i].fuelSeconds).toBeGreaterThan(byUnlock[i - 1].fuelSeconds);
    }
  });

  it("gives even the starter pad room for several boosts", () => {
    // If a launch can't afford a handful of boosts, LEO stops being playable.
    for (const s of SITES) {
      expect(s.fuelSeconds / TUNING.boostFuel).toBeGreaterThanOrEqual(4);
    }
  });

  it("looks up by id", () => {
    expect(siteById(SITES[0].id)?.name).toBe(SITES[0].name);
    expect(siteById("nope")).toBeUndefined();
  });
});

// How many contract regions one satellite serves at once, given where it is.
// Mirrors the scene's coverage test exactly (see GameScene.step).
function regionsServed(satAngle: number, radius: number): string[] {
  const hw = footprintHalfWidthFor(radius, TUNING.footprintHalfWidth);
  return REGIONS.filter((r) => Math.abs(angleDelta(satAngle, r.angle)) <= hw).map((r) => r.id);
}

describe("contract regions", () => {
  it("starts with exactly one signed contract", () => {
    const open = regionsUnlockedFor(0);
    expect(open).toHaveLength(1);
    expect(open[0].unlockValuation).toBe(0);
  });

  it("signs more contracts as valuation grows", () => {
    const counts = [0, 1000, 2000].map((v) => regionsUnlockedFor(v).length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBe(REGIONS.length);
  });

  it("interleaves with pad unlocks so progression alternates", () => {
    // Every unlock threshold in the game, in order, should alternate between
    // "reach higher" (pad) and "serve more" (contract) rather than clumping.
    const steps = [
      ...SITES.map((s) => ({ at: s.unlockValuation, kind: "pad" })),
      ...REGIONS.map((r) => ({ at: r.unlockValuation, kind: "contract" })),
    ]
      .filter((s) => s.at > 0)
      .sort((a, b) => a.at - b.at);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].kind).not.toBe(steps[i - 1].kind);
    }
  });

  it("looks up by id", () => {
    expect(regionById(REGIONS[0].id)?.name).toBe(REGIONS[0].name);
    expect(regionById("nope")).toBeUndefined();
  });

  it("adds up every region's rate as the income ceiling", () => {
    expect(maxIncome()).toBe(REGIONS.reduce((n, r) => n + r.payRate, 0));
    expect(maxIncome()).toBeGreaterThan(REGIONS[0].payRate);
  });

  // The load-bearing geometry. These pin the design intent stated in
  // regions.ts — change the angles and these tests tell you what you broke.
  it("spaces regions so one LEO satellite can never serve two at once", () => {
    const leo = BANDS[0].radius;
    for (let a = 0; a < Math.PI * 2; a += 0.01) {
      expect(regionsServed(a, leo).length).toBeLessThanOrEqual(1);
    }
  });

  it("lets one high satellite straddle the twin markets — the payoff for climbing", () => {
    // gulf + atlantic sit close enough that a widened high-orbit footprint
    // spans both. That doubled coverage is what pays for the lower band rate.
    const twins = ["gulf", "atlantic"];
    const mid = (regionById(twins[0])!.angle + regionById(twins[1])!.angle) / 2;

    // From the straddle point a GEO bird serves both markets at once...
    expect(regionsServed(mid, BANDS[2].radius).sort()).toEqual([...twins].sort());
    // ...while a LEO bird parked there reaches neither, and has to commit to
    // one market or the other.
    expect(regionsServed(mid, BANDS[0].radius)).toHaveLength(0);
    expect(regionsServed(regionById("gulf")!.angle, BANDS[0].radius)).toEqual(["gulf"]);
  });

  it("keeps the far market genuinely separate — no orbit covers all three", () => {
    for (let a = 0; a < Math.PI * 2; a += 0.01) {
      expect(regionsServed(a, 5000).length).toBeLessThan(REGIONS.length);
    }
  });
});
