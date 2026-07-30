import { describe, expect, it } from "vitest";
import {
  TWO_PI,
  advanceAngle,
  airDensity,
  angleDelta,
  ascentPoint,
  burnoutState,
  circularSpeed,
  isAngleCovered,
  normalizeAngle,
  orbitalElements,
  predictPath,
  stepBody,
  type BodyState,
  type DragModel,
} from "../../src/core/orbit";

const MU = 1.84e6;
const DRAG: DragModel = { earthRadius: 58, ceiling: 140, k: 0.012 };
const NO_DRAG: DragModel = { earthRadius: 58, ceiling: 58, k: 0 };

function circularState(r: number, mu = MU): BodyState {
  return { x: r, y: 0, vx: 0, vy: circularSpeed(mu, r) };
}

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

describe("orbital elements", () => {
  it("recognizes a circular orbit", () => {
    const el = orbitalElements(MU, circularState(150));
    expect(el.e).toBeLessThan(0.001);
    expect(el.perigee).toBeCloseTo(150, 0);
    expect(el.apogee).toBeCloseTo(150, 0);
    expect(el.energy).toBeLessThan(0);
  });

  it("computes an ellipse from a tangential over-speed", () => {
    // 10% over circular speed at r=150 → perigee stays at 150, apogee rises.
    const s = circularState(150);
    s.vy *= 1.1;
    const el = orbitalElements(MU, s);
    expect(el.e).toBeGreaterThan(0.1);
    expect(el.perigee).toBeCloseTo(150, 0);
    expect(el.apogee).toBeGreaterThan(190);
  });

  it("flags escape trajectories", () => {
    const r = 150;
    const s: BodyState = { x: r, y: 0, vx: 0, vy: Math.sqrt((2 * MU) / r) * 1.01 };
    const el = orbitalElements(MU, s);
    expect(el.e).toBeGreaterThanOrEqual(1);
    expect(el.apogee).toBe(Infinity);
    expect(el.energy).toBeGreaterThan(0);
  });
});

describe("integration", () => {
  it("holds a drag-free circular orbit for a full revolution", () => {
    const r = 150;
    const s = circularState(r);
    const period = TWO_PI * Math.sqrt(r ** 3 / MU);
    for (let t = 0; t < period; t += 1 / 60) stepBody(MU, s, 1 / 60, NO_DRAG);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(r, -1); // within ~5px
    const el = orbitalElements(MU, s);
    expect(el.e).toBeLessThan(0.05);
  });

  it("drag bleeds orbital energy; vacuum does not", () => {
    const low = circularState(120); // inside the 140 ceiling
    const before = orbitalElements(MU, low).energy;
    for (let i = 0; i < 120; i++) stepBody(MU, low, 1 / 60, DRAG);
    expect(orbitalElements(MU, low).energy).toBeLessThan(before);

    const high = circularState(300); // far above the ceiling
    const beforeHigh = orbitalElements(MU, high).energy;
    for (let i = 0; i < 120; i++) stepBody(MU, high, 1 / 60, DRAG);
    expect(orbitalElements(MU, high).energy).toBeCloseTo(beforeHigh, 0);
  });
});

describe("atmosphere", () => {
  it("density is 1 at the surface, 0 at the ceiling, linear between", () => {
    expect(airDensity(58, DRAG)).toBeCloseTo(1);
    expect(airDensity(140, DRAG)).toBe(0);
    expect(airDensity(400, DRAG)).toBe(0);
    expect(airDensity(99, DRAG)).toBeCloseTo(0.5);
  });
});

describe("burnout launch model", () => {
  it("places the stage downrange at the burnout radius", () => {
    const s = burnoutState(0, 0.35, 125, 120, 0, 0);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(125);
    expect(Math.atan2(s.y, s.x)).toBeCloseTo(0.35);
  });

  it("tangential burnout at circular speed yields a circular orbit", () => {
    const v = circularSpeed(MU, 125);
    const s = burnoutState(1.2, 0.35, 125, v, 0, 0);
    const el = orbitalElements(MU, s);
    expect(el.e).toBeLessThan(0.01);
    expect(el.perigee).toBeCloseTo(125, 0);
  });

  it("extra speed raises the apogee, keeps the perigee at burnout", () => {
    const v = circularSpeed(MU, 125) * 1.15;
    const el = orbitalElements(MU, burnoutState(0, 0.35, 125, v, 0, 0));
    expect(el.perigee).toBeCloseTo(125, 0);
    expect(el.apogee).toBeGreaterThan(180);
  });

  it("a lofted flight-path angle drops the perigee below burnout", () => {
    const v = circularSpeed(MU, 125);
    const el = orbitalElements(MU, burnoutState(0, 0.35, 125, v, 0.4, 0));
    expect(el.perigee).toBeLessThan(120);
  });

  it("ground rotation adds free prograde speed", () => {
    const withSpin = burnoutState(0, 0, 125, 100, 0, 0.17);
    const without = burnoutState(0, 0, 125, 100, 0, 0);
    const spinSpeed = Math.hypot(withSpin.vx, withSpin.vy);
    const stillSpeed = Math.hypot(without.vx, without.vy);
    expect(spinSpeed).toBeGreaterThan(stillSpeed);
  });

  it("the ascent arc runs pad to burnout", () => {
    const start = ascentPoint(60, 0, 0, 125, 0);
    const end = ascentPoint(60, 0, 0, 125, 1);
    expect(start.x).toBeCloseTo(60);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(125);
  });
});

describe("prediction", () => {
  it("a suborbital lob crashes back", () => {
    // Well under circular speed, tangential — a doomed hop.
    const s = burnoutState(0, 0.35, 125, 60, 0, 0);
    const p = predictPath(MU, s, DRAG, 20, 1400);
    expect(p.outcome).toBe("crashed");
    expect(p.points.length).toBeGreaterThan(2);
  });

  it("a healthy circular orbit keeps flying", () => {
    const p = predictPath(MU, circularState(200), NO_DRAG, 15, 1400);
    expect(p.outcome).toBe("flying");
    const rs = p.points.map((pt) => Math.hypot(pt.x, pt.y));
    for (const r of rs) expect(Math.abs(r - 200)).toBeLessThan(8);
  });

  it("past escape speed the path leaves the map", () => {
    const s = burnoutState(0, 0.35, 125, 200, 0, 0); // > v_esc(125) ≈ 171
    const p = predictPath(MU, s, NO_DRAG, 30, 1400);
    expect(p.outcome).toBe("escaped");
  });
});
