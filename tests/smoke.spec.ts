import { test, expect } from "@playwright/test";
import { TUNING } from "../src/sim/constants";
import {
  addCash,
  boost,
  bootGame,
  deorbit,
  events,
  launch,
  snapshot,
  waitFor,
  waitForEvent,
  waitForScene,
} from "./helpers/gameClient";

test("boots and reaches the game via autoplay", async ({ page }) => {
  await bootGame(page, { autoplay: true });
  await waitForScene(page, "game");
  const s = await snapshot(page);
  expect(s.ready).toBe(true);
  expect(s.cash).toBe(TUNING.startingCash);
  expect(s.valuation).toBe(0);
});

test("launching a satellite charges cash and inserts a live sat", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 6, debris: false });
  await waitForScene(page, "game");

  await launch(page, 0);
  const ev = await waitForEvent(page, "launch");
  expect(ev.cost).toBe(TUNING.launchCost);

  // The launch charges immediately — check before the sat can earn revenue.
  const charged = await snapshot(page);
  expect(charged.cash).toBe(TUNING.startingCash - TUNING.launchCost);

  await waitForEvent(page, "insert");
  await waitFor(page, (s) => s.satellites >= 1);
});

test("a neglected satellite decays, goes critical, then deorbits", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 8, debris: false });
  await waitForScene(page, "game");

  await launch(page, 0);
  await waitForEvent(page, "insert");
  await waitForEvent(page, "decay-critical");
  const gone = await waitForEvent(page, "deorbit");
  expect(gone.id).toBeGreaterThan(0);
  await waitFor(page, (s) => s.satellites === 0);
});

test("boosting refills altitude and staves off deorbit", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 6, debris: false });
  await waitForScene(page, "game");
  await addCash(page, 1000);

  await launch(page, 0);
  await waitForEvent(page, "insert");
  await waitForEvent(page, "decay-critical");
  await boost(page);
  const b = await waitForEvent(page, "boost");
  expect(b.altitude).toBeGreaterThan(TUNING.criticalAltitude);
});

test("sustained coverage earns revenue and grows valuation", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 6, debris: false });
  await waitForScene(page, "game");
  await addCash(page, 2000);

  // Ring the orbit with sats so the rotating contract region is served.
  for (let i = 0; i < 9; i++) await launch(page, (i / 9) * Math.PI * 2);
  await waitFor(page, (s) => s.covered === true);
  await waitForEvent(page, "revenue");
  await waitFor(page, (s) => s.valuation > 0);
});

test("running out of runway ends the run", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  await addCash(page, -TUNING.startingCash);
  const over = await waitForEvent(page, "bankruptcy");
  expect(over.valuation).toBeGreaterThanOrEqual(0);
  await waitFor(page, (s) => s.gameOver === true && s.gameOverReason === "bankruptcy");

  const log = await events(page);
  expect(log.some((e) => e.type === "bankruptcy")).toBe(true);
});

test("an unaffordable launch is refused with a typed reason", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  // Drain cash below the launch cost, then try to launch.
  await addCash(page, -(TUNING.startingCash - TUNING.launchCost + 10));
  await launch(page, 0);
  const blockedEv = await waitForEvent(page, "action-blocked");
  expect(blockedEv.action).toBe("launch");
  expect(blockedEv.reason).toBe("cash");

  // No launch happened: no launch event, cash unchanged.
  const log = await events(page);
  expect(log.some((e) => e.type === "launch")).toBe(false);
});

test("commanded de-orbit removes a sat cleanly, leaving no debris", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 4, debris: false });
  await waitForScene(page, "game");

  await launch(page, 0);
  const ins = await waitForEvent(page, "insert");
  await waitFor(page, (s) => s.satellites >= 1);

  await deorbit(page, ins.id);
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

  await launch(page, 0);
  await waitForEvent(page, "insert");

  // Ring the orbit with debris at the satellite's altitude; the faster debris
  // sweeps into it within a lap.
  await page.evaluate(() => {
    for (let i = 0; i < 14; i++) window.__PERIGEE!.cheat.spawnDebris((i / 14) * Math.PI * 2, 1);
  });

  const hit = await waitForEvent(page, "collision");
  expect(hit.satId).toBeGreaterThan(0);
  const log = await events(page);
  expect(log.some((e) => e.type === "deorbit" && e.reason === "collision")).toBe(true);
  expect(log.some((e) => e.type === "debris-spawn" && e.source === "collision")).toBe(true);
});

test("too much debris triggers a Kessler cascade and ends the run", async ({ page }) => {
  await bootGame(page, { autoplay: true, debris: false });
  await waitForScene(page, "game");

  // Flood the ring past the cascade cap in one shot.
  await page.evaluate((cap) => {
    for (let i = 0; i < cap + 2; i++) {
      window.__PERIGEE!.cheat.spawnDebris((i / (cap + 2)) * Math.PI * 2, 1);
    }
  }, TUNING.kesslerCap);

  const cascade = await waitForEvent(page, "kessler-cascade");
  expect(cascade.debris).toBeGreaterThanOrEqual(TUNING.kesslerCap);
  await waitFor(page, (s) => s.gameOver === true && s.gameOverReason === "kessler");
});
