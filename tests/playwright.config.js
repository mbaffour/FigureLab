// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  fullyParallel: false,        // single big single-file app; keep deterministic
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    headless: true,
    // app uses file:// — no baseURL/server needed
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
