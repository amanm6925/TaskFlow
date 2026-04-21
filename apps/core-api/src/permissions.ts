import { Role } from '@prisma/client';
import { prisma } from './db.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export async function requireMembership(userId: string, organizationId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  if (!membership) throw new HttpError(404, 'org_not_found');
  return membership;
}

export function roleAtLeast(role: Role, min: Role): boolean {
  const order: Role[] = [Role.VIEWER, Role.MEMBER, Role.ADMIN, Role.OWNER];
  return order.indexOf(role) >= order.indexOf(min);
}

export function requireRole(role: Role, min: Role) {
  if (!roleAtLeast(role, min)) {
    throw new HttpError(403, 'forbidden', `requires role ${min} or higher`);
  }
}
