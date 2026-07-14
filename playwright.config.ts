import { defineConfig, devices } from "@playwright/test";

const externalServer=process.env.PLAYWRIGHT_EXTERNAL_SERVER==="1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["line"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL??"http://localhost:4190",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
  webServer: externalServer?undefined:{
    command: "npm run dev -- --port 4190",
    url: "http://localhost:4190",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
