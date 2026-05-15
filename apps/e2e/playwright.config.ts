import { defineConfig, devices } from "@playwright/test"

const WEB_PORT = Number(process.env.PID_E2E_WEB_PORT ?? 15173)

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
