import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { DATABASE_URL, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER } from './playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
const coreApiDir = path.resolve(here, '../apps/core-api');

async function recreateDatabase() {
  const admin = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  try {
    // Terminate any open connections to the e2e DB before dropping.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DB_NAME]
    );
    await admin.query(`DROP DATABASE IF EXISTS "${DB_NAME}"`);
    await admin.query(`CREATE DATABASE "${DB_NAME}"`);
  } finally {
    await admin.end();
  }
}

export default async function globalSetup() {
  // Recreate the e2e database from scratch so every test run starts deterministic.
  await recreateDatabase();

  // Apply migrations against it — no `migrate dev`, no generation, just replay.
  execSync('npx prisma migrate deploy', {
    cwd: coreApiDir,
    env: { ...process.env, DATABASE_URL },
    stdio: 'inherit',
  });

  // Expose the DB URL to tests for the per-test reset helper.
  process.env.E2E_DATABASE_URL = DATABASE_URL;
}
