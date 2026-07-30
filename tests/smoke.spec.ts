import { test, expect } from "@playwright/test";
import { TUNING } from "../src/sim/constants";
import { SITES } from "../src/sim/sites";
import { bandFor } from "../src/sim/bands";
import {
  addCash,
  addValuation,
  boost,
  bootGame,
  deorbit,
  events,
  launch,
  selectSite,
  snapshot,
  spawnDebris,
  spawnSat,
  waitFor,
  waitForEvent,
  waitForEventAfter,
  waitForScene,
} from "./helpers/gameClient";

// Calibrated launch settings (see the aim/power envelope in the handbook):
// power 0.25 ≈ 105 px/s tangential → clean circular LEO. Aim -30 at power 0
// digs the perigee into the planet — a doomed lob.
const GOOD_LAUNCH = { fpa: 0, power: 0.25 };
const BAD_LAUNCH = { fpa: -30, power: 0 };

test("boots and reaches the game via autoplay", async ({ page }) => {
  await bootGame(page, { autoplay: true });
  await waitForScene(page, "game");
  const s = await snapshot(page);
  expect(s.ready).toBe(true);
  expect(s.cash).toBe(TUNING.startingCash);
  expect(s.valuation).toBe(0);
});

test("a well-aimed launch charges cash and inserts into a stable orbit", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 4, debris: false });
  await waitForScene(page, "game");

  await launch(page, GOOD_LAUNCH.fpa, GOOD_LAUNCH.power);
  const ev = await waitForEvent(page, "launch");
  expect(ev.cost).toBe(TUNING.launchCost);

  // The launch charges immediately — check before the sat can earn revenue.
  const charged = await snapshot(page);
  expect(charged.cash).toBe(TUNING.startingCash - TUNING.launchCost);

  const ins = await waitForEvent(page, "insert");
  expect(ins.perigee).toBeGreaterThanOrEqual(TUNING.insertFloor);
  await waitFor(page, (s) => s.satellites >= 1);
});

test("a botched launch never inserts and crashes back", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 8, debris: false });
  await waitForScene(page, "game");

  await launch(page, BAD_LAUNCH.fpa, BAD_LAUNCH.power);
  const gone = await waitForEvent(page, "deorbit");
  expect(gone.reason).toBe("crash");
  const log = await events(page);
  expect(log.some((e) => e.type === "insert")).toBe(false);
});

test("a low orbit drags down: decay-critical, then burn-up", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 8, debris: false });
  await waitForScene(page, "game");

  // Circular orbit inside the atmosphere — drag will pull it down.
  await spawnSat(page, 0, 125);
  await waitForEvent(page, "decay-critical", 30_000);
  const gone = await waitForEvent(page, "deorbit", 30_000);
  expect(gone.reason).toBe("decay");
  await waitFor(page, (s) => s.satellites === 0);
});

test("a prograde boost raises the orbit's far side (apogee)", async ({ page }) => {
  // Real orbital mechanics: a prograde burn raises the OPPOSITE side of the
  // orbit. On a circular orbit that means the apogee climbs; the perigee only
  // climbs when you boost near apogee. Assert the honest version.
  await bootGame(page, { autoplay: true, timeScale: 2, debris: false });
  await waitForScene(page, "game");
  await addCash(page, 500);

  await spawnSat(page, 0, 120); // decaying LEO orbit
  await waitFor(page, (s) => s.satellites === 1);
  const before = await snapshot(page);
  const apogeeBefore = before.fleet[0].apogee;

  await boost(page);
  const b = await waitForEvent(page, "boost");
  expect(b.dv).toBe(TUNING.boostDv);
  const after = await snapshot(page);
  expect(after.fleet[0].apogee).toBeGreaterThan(apogeeBefore + 5);
});

test("sustained coverage earns revenue and grows valuation", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 4, debris: false });
  await waitForScene(page, "game");

  // Ring a stable orbit (above the atmosphere) so the region stays served.
  for (let i = 0; i < 8; i++) await spawnSat(page, (i / 8) * Math.PI * 2, 160);
  await waitFor(page, (s) => s.covered === true);
  await waitForEvent(page, "revenue");
  await waitFor(page, (s) => s.valuation > 0);
});

test("an unaffordable launch is refused with a typed reason", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  await addCash(page, -(TUNING.startingCash - TUNING.launchCost + 10));
  await launch(page, GOOD_LAUNCH.fpa, GOOD_LAUNCH.power);
  const blockedEv = await waitForEvent(page, "action-blocked");
  expect(blockedEv.action).toBe("launch");
  expect(blockedEv.reason).toBe("cash");

  const log = await events(page);
  expect(log.some((e) => e.type === "launch")).toBe(false);
});

test("commanded de-orbit removes a sat cleanly, leaving no debris", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 2, debris: false });
  await waitForScene(page, "game");

  await spawnSat(page, 0, 160);
  await waitFor(page, (s) => s.satellites === 1);

  await deorbit(page);
  const gone = await waitForEvent(page, "deorbit");
  expect(gone.reason).toBe("commanded");
  await waitFor(page, (s) => s.satellites === 0);

  const s = await snapshot(page);
  expect(s.debris).toBe(0);
});

test("ambient debris arrives on its own and drives Kessler risk up", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 8, seed: 7 });
  await waitForScene(page, "game");

  const d = await waitForEvent(page, "debris-spawn");
  expect(d.source).toBe("ambient");
  await waitFor(page, (s) => s.debris >= 1 && s.kesslerRisk > 0);
});

test("debris colliding with a satellite destroys it and spawns fragments", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 4, debris: false });
  await waitForScene(page, "game");

  // Head-on: a prograde sat and a retrograde debris on the same circle.
  await spawnSat(page, 0, 160);
  await spawnDebris(page, Math.PI, 160, -1);

  const hit = await waitForEvent(page, "collision", 20_000);
  expect(hit.satId).toBeGreaterThan(0);
  const log = await events(page);
  expect(log.some((e) => e.type === "deorbit" && e.reason === "collision")).toBe(true);
  expect(log.some((e) => e.type === "debris-spawn" && e.source === "collision")).toBe(true);
});

test("too much debris triggers a Kessler cascade and ends the run", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  // Flood a stable radius past the cascade cap in one shot.
  await page.evaluate((cap) => {
    for (let i = 0; i < cap + 2; i++) {
      window.__PERIGEE!.cheat.spawnDebris((i / (cap + 2)) * Math.PI * 2, 165, 1);
    }
  }, TUNING.kesslerCap);

  const cascade = await waitForEvent(page, "kessler-cascade");
  expect(cascade.debris).toBeGreaterThanOrEqual(TUNING.kesslerCap);
  await waitFor(page, (s) => s.gameOver === true && s.gameOverReason === "kessler");
});

test("only the starter pad is available at zero valuation", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");
  const s = await snapshot(page);
  expect(s.unlockedSites).toEqual([SITES[0].id]);
  expect(s.activeSite).toBe(SITES[0].id);
});

test("a locked launch site is refused with a typed reason", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  await selectSite(page, SITES[2].id);
  const blockedEv = await waitForEvent(page, "action-blocked");
  expect(blockedEv.action).toBe("select-site");
  expect(blockedEv.reason).toBe("locked");

  const s = await snapshot(page);
  expect(s.activeSite).toBe(SITES[0].id);
});

test("valuation unlocks better pads, which can be selected", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  await addValuation(page, SITES[2].unlockValuation);
  const unlocked = await waitForEvent(page, "site-unlocked");
  expect(SITES.map((s) => s.id)).toContain(unlocked.siteId);
  await waitFor(page, (s) => s.unlockedSites.length === 3);

  await selectSite(page, SITES[2].id);
  await waitFor(page, (s, id) => s.activeSite === id, 15_000, SITES[2].id);
});

test("the starter pad can't reach high orbit, but the best pad can", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 4, debris: false });
  await waitForScene(page, "game");
  await addCash(page, 2000);

  // Full power from the starter pad is capped — it only reaches LEO.
  await launch(page, 0, 1);
  const weak = await waitForEvent(page, "launch");
  expect(weak.power).toBeLessThanOrEqual(SITES[0].maxPower + 0.001);
  const leo = await waitForEvent(page, "insert");
  expect(bandFor(leo.apogee).id).toBe("LEO");

  // The top pad lifts the ceiling: same aim, far higher apogee.
  await addValuation(page, SITES[2].unlockValuation);
  await selectSite(page, SITES[2].id);
  await waitFor(page, (s, id) => s.activeSite === id, 15_000, SITES[2].id);

  await launch(page, 0, 0.62);
  const strong = await waitForEventAfter(page, "launch", weak.t);
  expect(strong.power).toBeGreaterThan(SITES[0].maxPower);

  await waitFor(page, (s) => s.fleet.some((f) => f.apogee > 250), 20_000);
});

test("running out of runway ends the run", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  await addCash(page, -TUNING.startingCash);
  const over = await waitForEvent(page, "bankruptcy");
  expect(over.valuation).toBeGreaterThanOrEqual(0);
  await waitFor(page, (s) => s.gameOver === true && s.gameOverReason === "bankruptcy");
});
