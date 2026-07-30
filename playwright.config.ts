import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// Sandboxed dev environments often can't download Playwright's pinned browser.
// Point this at a preinstalled Chromium to run against it instead, e.g.:
//   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium/chrome pnpm test
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 800, height: 800 },
  },
  projects: [
    {
      name: "chromium",
      // unit/ belongs to Vitest (pnpm test:unit), not Playwright.
      testIgnore: ["**/unit/**"],
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm preview",
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  outputDir: "test-results/",
});
