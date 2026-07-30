import { describe, expect, it } from "vitest";
import { accrueRevenue, canAfford, isBankrupt, spend } from "../../src/core/economy";

describe("economy", () => {
  it("accrues revenue into both cash and valuation", () => {
    const w = accrueRevenue({ cash: 100, valuation: 0 }, 24, 0.5);
    expect(w.cash).toBeCloseTo(112);
    expect(w.valuation).toBeCloseTo(12);
  });

  it("only affords what the cash covers", () => {
    expect(canAfford(110, 110)).toBe(true);
    expect(canAfford(109, 110)).toBe(false);
  });

  it("spends by subtracting", () => {
    expect(spend(500, 110)).toBe(390);
  });

  it("is bankrupt only once cash is gone", () => {
    expect(isBankrupt(0.01)).toBe(false);
    expect(isBankrupt(0)).toBe(true);
    expect(isBankrupt(-5)).toBe(true);
  });
});
