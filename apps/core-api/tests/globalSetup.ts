import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

function ensureDockerHost() {
  if (process.env.DOCKER_HOST) return;
  const home = process.env.HOME ?? '';
  const candidates = [
    `${home}/.colima/default/docker.sock`,
    `${home}/.docker/run/docker.sock`,
    '/var/run/docker.sock',
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      process.env.DOCKER_HOST = `unix://${p}`;
      return;
    }
  }
}

export async function setup() {
  ensureDockerHost();
  process.env.TESTCONTAINERS_RYUK_DISABLED = process.env.TESTCONTAINERS_RYUK_DISABLED ?? 'true';

  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('taskflow_test')
    .withUsername('taskflow_test')
    .withPassword('taskflow_test')
    .start();

  // Admin URL (superuser inside the container). Used for migrations and fixtures.
  const adminUrl = container.getConnectionUri();
  // App URL. The taskflow_app role is created by the RLS migration.
  const host = container.getHost();
  const port = container.getPort();
  const db = container.getDatabase();
  const appUrl = `postgresql://taskflow_app:taskflow_app_pw@${host}:${port}/${db}`;

  process.env.DATABASE_URL = adminUrl;
  process.env.DATABASE_URL_APP = appUrl;
  process.env.TEST_DATABASE_URL = adminUrl;
  process.env.TEST_DATABASE_URL_APP = appUrl;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: adminUrl },
    stdio: 'inherit',
  });
}

export async function teardown() {
  await container?.stop();
}
