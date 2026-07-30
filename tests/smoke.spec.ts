import { test, expect } from "@playwright/test";
import { TUNING } from "../src/sim/constants";
import {
  addCash,
  boost,
  bootGame,
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
  await bootGame(page, { autoplay: true, timeScale: 6 });
  await waitForScene(page, "game");

  await launch(page, 0);
  const ev = await waitForEvent(page, "launch");
  expect(ev.cost).toBe(TUNING.launchCost);

  await waitForEvent(page, "insert");
  await waitFor(page, (s) => s.satellites >= 1);
  const s = await snapshot(page);
  expect(s.cash).toBe(TUNING.startingCash - TUNING.launchCost);
});

test("a neglected satellite decays, goes critical, then deorbits", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 8 });
  await waitForScene(page, "game");

  await launch(page, 0);
  await waitForEvent(page, "insert");
  await waitForEvent(page, "decay-critical");
  const gone = await waitForEvent(page, "deorbit");
  expect(gone.id).toBeGreaterThan(0);
  await waitFor(page, (s) => s.satellites === 0);
});

test("boosting refills altitude and staves off deorbit", async ({ page }) => {
  await bootGame(page, { autoplay: true, timeScale: 6 });
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
  await bootGame(page, { autoplay: true, timeScale: 6 });
  await waitForScene(page, "game");
  await addCash(page, 2000);

  // Ring the orbit with sats so the rotating contract region is served.
  for (let i = 0; i < 9; i++) await launch(page, (i / 9) * Math.PI * 2);
  await waitFor(page, (s) => s.covered === true);
  await waitForEvent(page, "revenue");
  await waitFor(page, (s) => s.valuation > 0);
});

test("running out of runway ends the run", async ({ page }) => {
  await bootGame(page, { autoplay: true });
  await waitForScene(page, "game");

  await addCash(page, -TUNING.startingCash);
  const over = await waitForEvent(page, "bankruptcy");
  expect(over.valuation).toBeGreaterThanOrEqual(0);
  await waitFor(page, (s) => s.gameOver === true);

  const log = await events(page);
  expect(log.some((e) => e.type === "bankruptcy")).toBe(true);
});
