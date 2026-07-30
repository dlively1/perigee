import { describe, expect, it } from "vitest";
import {
  TWO_PI,
  advanceAngle,
  angleDelta,
  boostAltitude,
  decayAltitude,
  isAngleCovered,
  normalizeAngle,
  orbitRadius,
} from "../../src/core/orbit";

describe("angles", () => {
  it("normalizes into [0, 2π)", () => {
    expect(normalizeAngle(-0.5)).toBeCloseTo(TWO_PI - 0.5);
    expect(normalizeAngle(TWO_PI + 1)).toBeCloseTo(1);
    expect(normalizeAngle(0)).toBe(0);
  });

  it("computes shortest signed delta across the wrap", () => {
    expect(angleDelta(0.1, TWO_PI - 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(TWO_PI - 0.1, 0.1)).toBeCloseTo(-0.2);
    expect(Math.abs(angleDelta(0, Math.PI))).toBeCloseTo(Math.PI);
  });

  it("advances by ω·dt and wraps", () => {
    expect(advanceAngle(0, Math.PI, 1)).toBeCloseTo(Math.PI);
    expect(advanceAngle(Math.PI, Math.PI, 1.5)).toBeCloseTo(normalizeAngle(2.5 * Math.PI));
  });
});

describe("altitude", () => {
  it("decays linearly and floors at 0", () => {
    expect(decayAltitude(1, 0.5, 1)).toBeCloseTo(0.5);
    expect(decayAltitude(0.2, 0.5, 1)).toBe(0);
  });

  it("boosts and caps at 1", () => {
    expect(boostAltitude(0.5, 0.3)).toBeCloseTo(0.8);
    expect(boostAltitude(0.8, 0.5)).toBe(1);
  });

  it("maps altitude to a spiral-in radius", () => {
    expect(orbitRadius(200, 1)).toBeCloseTo(200);
    expect(orbitRadius(200, 0, 0.6)).toBeCloseTo(120);
    expect(orbitRadius(200, 0.5, 0.6)).toBeCloseTo(160);
  });
});

describe("coverage", () => {
  const hw = 0.3;
  it("is covered when a sat sits within ±halfWidth of the region", () => {
    expect(isAngleCovered([0.2], 0.0, hw)).toBe(true);
    expect(isAngleCovered([1.0], 0.0, hw)).toBe(false);
  });

  it("covers across the 0/2π wrap", () => {
    expect(isAngleCovered([TWO_PI - 0.1], 0.1, hw)).toBe(true);
  });

  it("any live sat can hold coverage", () => {
    expect(isAngleCovered([3.0, 0.1, 5.0], 0.0, hw)).toBe(true);
    expect(isAngleCovered([], 0.0, hw)).toBe(false);
  });
});
