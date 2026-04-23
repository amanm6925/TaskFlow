import type { Prisma } from '@prisma/client';
import { prisma, prismaAdmin } from './db.js';

export type Tx = Prisma.TransactionClient;

/**
 * Run `fn` in a database transaction with the current user's id bound to the
 * Postgres session variable `app.current_user_id`. The binding uses
 * `set_config(..., is_local=true)` which is transaction-scoped (equivalent to
 * SET LOCAL) and safe against the connection pool returning the connection to
 * another request.
 *
 * In PR 3a this is a no-op as far as behavior — no RLS policies read the
 * variable yet. In PR 3b it becomes the mechanism that scopes every query to
 * the current tenant.
 */
export async function withTx<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/**
 * Transaction on the admin client — bypasses RLS. Use sparingly:
 *  - Unauthenticated paths (signup/login/refresh) that touch only non-RLS tables
 *  - Bootstrap paths like creating an org + first membership atomically
 *    (the user cannot be a member yet, so the app client's policies would reject)
 */
export async function withAdminTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prismaAdmin.$transaction(async (tx) => fn(tx));
}
