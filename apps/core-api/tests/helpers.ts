import type { FastifyInstance } from 'fastify';
import { Role, TaskPriority, TaskStatus } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/db.js';

let appInstance: FastifyInstance | undefined;

export async function getTestApp(): Promise<FastifyInstance> {
  if (!appInstance) {
    appInstance = await buildApp({ logger: false });
    await appInstance.ready();
  }
  return appInstance;
}

export async function closeTestApp() {
  if (appInstance) {
    await appInstance.close();
    appInstance = undefined;
  }
  await prisma.$disconnect();
}

const APP_TABLES = [
  'refresh_tokens',
  'tasks',
  'projects',
  'memberships',
  'organizations',
  'users',
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${APP_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`
  );
}

export type SignupResult = {
  user: { id: string; email: string; name: string };
  accessToken: string;
  refreshToken: string;
};

let userCounter = 0;

export async function signupUser(overrides: { email?: string; password?: string; name?: string } = {}): Promise<SignupResult> {
  const app = await getTestApp();
  userCounter += 1;
  const email = overrides.email ?? `user${userCounter}+${Date.now()}@test.local`;
  const password = overrides.password ?? 'correct-horse-battery-staple';
  const name = overrides.name ?? `User ${userCounter}`;

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password, name },
  });
  if (response.statusCode !== 201) {
    throw new Error(`signup failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as SignupResult;
}

export async function loginUser(email: string, password: string) {
  const app = await getTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  return response;
}

let orgCounter = 0;

export async function createOrg(ownerUserId: string, overrides: { name?: string; slug?: string } = {}) {
  orgCounter += 1;
  const name = overrides.name ?? `Org ${orgCounter}`;
  const slug = overrides.slug ?? `org-${orgCounter}-${Date.now()}`;
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name, slug } });
    await tx.membership.create({
      data: { userId: ownerUserId, organizationId: org.id, role: Role.OWNER },
    });
    return org;
  });
}

export async function addMember(userId: string, orgId: string, role: Role) {
  return prisma.membership.create({
    data: { userId, organizationId: orgId, role },
  });
}

let projectCounter = 0;

export async function createProject(
  orgId: string,
  createdById: string,
  overrides: { name?: string; key?: string } = {},
) {
  projectCounter += 1;
  const name = overrides.name ?? `Project ${projectCounter}`;
  const key = overrides.key ?? `P${projectCounter}${Date.now().toString().slice(-4)}`;
  return prisma.project.create({
    data: { organizationId: orgId, name, key: key.toUpperCase().slice(0, 10), createdById },
  });
}

export async function createTask(
  projectId: string,
  reporterId: string,
  overrides: { title?: string; assigneeId?: string | null; status?: TaskStatus; priority?: TaskPriority } = {},
) {
  const max = await prisma.task.aggregate({ _max: { number: true }, where: { projectId } });
  const number = (max._max.number ?? 0) + 1;
  return prisma.task.create({
    data: {
      projectId,
      number,
      title: overrides.title ?? `Task ${number}`,
      reporterId,
      assigneeId: overrides.assigneeId ?? null,
      status: overrides.status ?? TaskStatus.TODO,
      priority: overrides.priority ?? TaskPriority.MEDIUM,
    },
  });
}

export function authHeader(accessToken: string) {
  return { authorization: `Bearer ${accessToken}` };
}
