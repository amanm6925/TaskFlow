import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

/**
 * Runtime client — connects as the restricted `taskflow_app` role.
 * RLS policies apply to every query made through this client.
 * Handlers should use this (via withTx from tenant.ts).
 */
export const prisma = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL_APP } },
});

/**
 * Admin client — connects as the migrator/owner role, which bypasses RLS.
 * Only two legitimate uses:
 *  1. Unauthenticated bootstrap paths (POST /api/orgs), wrapped by withAdminTx.
 *  2. Test fixtures that need to seed data across tenants.
 */
export const prismaAdmin = new PrismaClient({
  datasources: { db: { url: env.DATABASE_URL } },
});
