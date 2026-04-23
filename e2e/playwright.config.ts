import { defineConfig } from '@playwright/test';

export const API_PORT = 3101;
export const FRONTEND_PORT = 3100;
export const API_BASE = `http://localhost:${API_PORT}`;
export const FRONTEND_BASE = `http://localhost:${FRONTEND_PORT}`;

export const DB_HOST = process.env.E2E_DB_HOST ?? 'localhost';
export const DB_PORT = Number(process.env.E2E_DB_PORT ?? 5432);
export const DB_USER = process.env.E2E_DB_USER ?? 'taskflow';
export const DB_PASSWORD = process.env.E2E_DB_PASSWORD ?? 'taskflow_dev_pw';
export const DB_NAME = process.env.E2E_DB_NAME ?? 'taskflow_e2e';
export const DATABASE_URL =
  `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

const coreApiEnv = {
  DATABASE_URL,
  PORT: String(API_PORT),
  JWT_SECRET: 'e2e_jwt_secret_at_least_32_chars_long_xxx',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '30',
  CORS_ORIGIN: FRONTEND_BASE,
  NODE_ENV: 'test',
};

const frontendEnv = {
  PORT: String(FRONTEND_PORT),
  NEXT_PUBLIC_API_BASE: API_BASE,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: './globalSetup.ts',
  use: {
    baseURL: FRONTEND_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm --prefix ../apps/core-api run start',
      url: `${API_BASE}/health`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: coreApiEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'npm --prefix ../apps/frontend run dev',
      url: FRONTEND_BASE,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: frontendEnv,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
