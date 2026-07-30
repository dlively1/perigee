import { describe, expect, it } from "vitest";
import { BANDS, bandFor, footprintHalfWidthFor, rateMultiplier } from "../../src/sim/bands";
import { SITES, siteById, sitesUnlockedFor } from "../../src/sim/sites";

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

  it("looks up by id", () => {
    expect(siteById(SITES[0].id)?.name).toBe(SITES[0].name);
    expect(siteById("nope")).toBeUndefined();
  });
});
