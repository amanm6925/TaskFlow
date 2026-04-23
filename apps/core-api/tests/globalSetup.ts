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

  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.TEST_DATABASE_URL = databaseUrl;

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

export async function teardown() {
  await container?.stop();
}
