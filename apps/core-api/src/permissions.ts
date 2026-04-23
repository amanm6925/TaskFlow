import type { FastifyRequest } from 'fastify';
import { Role, type Membership } from '@prisma/client';
import { prisma } from './db.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export type Action =
  | 'org:read'
  | 'org:update'
  | 'org:delete'
  | 'member:read'
  | 'member:invite'
  | 'member:update'
  | 'member:remove'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'task:read'
  | 'task:create'
  | 'task:update'
  | 'task:delete';

const permissions: Record<Action, Role[]> = {
  'org:read':        [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER],
  'org:update':      [Role.OWNER, Role.ADMIN],
  'org:delete':      [Role.OWNER],
  'member:read':     [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER],
  'member:invite':   [Role.OWNER, Role.ADMIN],
  'member:update':   [Role.OWNER, Role.ADMIN],
  'member:remove':   [Role.OWNER, Role.ADMIN],
  'project:read':    [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER],
  'project:create':  [Role.OWNER, Role.ADMIN],
  'project:update':  [Role.OWNER, Role.ADMIN],
  'project:delete':  [Role.OWNER, Role.ADMIN],
  'task:read':       [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER],
  'task:create':     [Role.OWNER, Role.ADMIN, Role.MEMBER],
  'task:update':     [Role.OWNER, Role.ADMIN, Role.MEMBER],
  'task:delete':     [Role.OWNER, Role.ADMIN, Role.MEMBER],
};

export function can(action: Action, role: Role): boolean {
  return permissions[action].includes(role);
}

type Scope = { orgId: string };

export type AuthContext = { membership: Membership };

/**
 * Authorize the authenticated request to perform `action` in the given org scope.
 *
 * 404 if the user has no membership in the org — chosen over 403 to avoid
 * leaking existence of orgs the caller cannot see.
 * 403 if the membership exists but the role is insufficient.
 */
export async function authorize(
  request: FastifyRequest,
  action: Action,
  scope: Scope,
): Promise<AuthContext> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: request.user.userId,
        organizationId: scope.orgId,
      },
    },
  });
  if (!membership) throw new HttpError(404, 'org_not_found');
  if (!can(action, membership.role)) {
    throw new HttpError(403, 'forbidden', `role ${membership.role} cannot ${action}`);
  }
  return { membership };
}

/**
 * Load membership for the authenticated request without running the matrix check.
 * Useful when the handler needs the membership for a resource-specific override
 * (e.g. reporter-can-delete-own-task) and will decide on the role itself.
 */
export async function loadMembership(request: FastifyRequest, scope: Scope): Promise<Membership> {
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: {
        userId: request.user.userId,
        organizationId: scope.orgId,
      },
    },
  });
  if (!membership) throw new HttpError(404, 'org_not_found');
  return membership;
}
