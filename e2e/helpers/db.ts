import { Client } from 'pg';

const APP_TABLES = [
  'refresh_tokens',
  'tasks',
  'projects',
  'memberships',
  'organizations',
  'users',
];

export async function resetDb() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error('E2E_DATABASE_URL not set — globalSetup must run first');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `TRUNCATE TABLE ${APP_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
    );
  } finally {
    await client.end();
  }
}
