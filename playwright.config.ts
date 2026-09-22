import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./test/browser",
  fullyParallel: true,
  workers: 3,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4179", trace: "retain-on-failure" },
  webServer: {
    command: "node test/browser/server.mjs",
    url: "http://127.0.0.1:4179/health",
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
