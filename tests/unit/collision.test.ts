import { describe, expect, it } from "vitest";
import { TWO_PI, willCollide } from "../../src/core/orbit";

describe("willCollide", () => {
  const angT = 0.1;
  const radT = 12;

  it("collides only when close in both angle and radius", () => {
    expect(willCollide(1.0, 200, 1.05, 205, angT, radT)).toBe(true);
    // Same angle, far apart in altitude → miss.
    expect(willCollide(1.0, 200, 1.0, 160, angT, radT)).toBe(false);
    // Same altitude, far apart in angle → miss.
    expect(willCollide(1.0, 200, 2.0, 200, angT, radT)).toBe(false);
  });

  it("respects the angular wrap at 0 / 2π", () => {
    expect(willCollide(0.02, 200, TWO_PI - 0.02, 200, angT, radT)).toBe(true);
  });

  it("is symmetric in its two bodies", () => {
    expect(willCollide(1.0, 200, 1.05, 206, angT, radT)).toBe(
      willCollide(1.05, 206, 1.0, 200, angT, radT),
    );
  });
});
