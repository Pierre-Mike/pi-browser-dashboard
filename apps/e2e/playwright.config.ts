import { defineConfig, devices } from "@playwright/test"

const WEB_PORT = Number(process.env.PID_E2E_WEB_PORT ?? 15173)

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Retry on CI only: the suite drives a live daemon + SSE stream whose
  // delivery timing varies under runner load. A transient miss should not
  // hard-fail an otherwise-passing PR. Local runs stay at 0 to surface flakes.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: { mode: "on", fullPage: true },
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
