import type { Page } from "@playwright/test";
import type { GameSnapshot, GameEvent } from "../../src/agent/events";

export interface GameClientOptions {
  seed?: number;
  autoplay?: boolean;
  debug?: boolean;
  paused?: boolean;
  muted?: boolean;
  // Run the sim N× faster (1–8) to cut wall-clock time on tests that wait for
  // organic decay / deorbit.
  timeScale?: number;
}

export async function bootGame(page: Page, opts: GameClientOptions = {}): Promise<void> {
  const params = new URLSearchParams();
  if (opts.seed != null) params.set("seed", String(opts.seed));
  if (opts.autoplay) params.set("autoplay", "1");
  if (opts.debug) params.set("debug", "1");
  if (opts.paused) params.set("paused", "1");
  if (opts.muted !== false) params.set("muted", "1");
  if (opts.timeScale != null) params.set("timeScale", String(opts.timeScale));
  const qs = params.toString();
  await page.goto(`/${qs ? `?${qs}` : ""}`);
  await page.waitForFunction(() => !!window.__PERIGEE?.snapshot.ready, undefined, {
    timeout: 15_000,
  });
}

export async function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => ({ ...window.__PERIGEE!.snapshot }));
}

export async function events(page: Page): Promise<GameEvent[]> {
  return page.evaluate(() => [...(window.__PERIGEE?.events ?? [])]);
}

export async function waitForScene(page: Page, name: string, timeoutMs = 8_000): Promise<void> {
  await page.waitForFunction((n) => window.__PERIGEE?.snapshot.scene === n, name, {
    timeout: timeoutMs,
  });
}

export async function launch(page: Page, angle: number): Promise<void> {
  await page.evaluate((a) => window.__PERIGEE!.input.launch(a), angle);
}

export async function boost(page: Page, id?: number): Promise<void> {
  await page.evaluate((i) => window.__PERIGEE!.input.boost(i), id);
}

export async function addCash(page: Page, amount: number): Promise<void> {
  await page.evaluate((a) => window.__PERIGEE!.cheat.addCash(a), amount);
}

export async function waitFor(
  page: Page,
  predicate: (s: GameSnapshot) => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForFunction(
    (fnStr) => {
      const s = window.__PERIGEE?.snapshot;
      if (!s) return false;
      return new Function("s", `return (${fnStr})(s)`)(s);
    },
    predicate.toString(),
    { timeout: timeoutMs },
  );
}

export async function waitForEvent<T extends GameEvent["type"]>(
  page: Page,
  type: T,
  timeoutMs = 15_000,
): Promise<Extract<GameEvent, { type: T }>> {
  const handle = await page.waitForFunction(
    (t) => window.__PERIGEE?.events.find((e) => e.type === t) ?? null,
    type,
    { timeout: timeoutMs },
  );
  return (await handle.jsonValue()) as Extract<GameEvent, { type: T }>;
}
