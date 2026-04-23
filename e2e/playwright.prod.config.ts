import { defineConfig } from '@playwright/test';

// Usage:
//   PROD_URL=https://taskflow-140-245-231-59.nip.io npm run test:prod
//
// Unlike playwright.config.ts (which spins up local servers + Testcontainers),
// this config assumes a deployed, reachable TaskFlow. It only runs tests from
// tests-prod/ so the regular E2E run (npm test) is unaffected.

const rawUrl = process.env.PROD_URL;
if (!rawUrl) {
  throw new Error('PROD_URL must be set, e.g. PROD_URL=https://taskflow-X-X-X-X.nip.io');
}
const PROD_URL = rawUrl.replace(/\/$/, '');

export default defineConfig({
  testDir: './tests-prod',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-prod' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: PROD_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // PLAYWRIGHT_SLOWMO=500 npm run test:prod:headed → 500ms pause between actions.
    // No effect on headless runs since there's nothing to watch.
    launchOptions: {
      slowMo: Number(process.env.PLAYWRIGHT_SLOWMO ?? 0),
    },
  },
});
