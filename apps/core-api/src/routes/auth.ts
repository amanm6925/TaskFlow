import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../auth.js';
import { HttpError } from '../permissions.js';

const signupBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

const loginBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

function publicUser(u: { id: string; email: string; name: string; avatarUrl: string | null; createdAt: Date }) {
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, createdAt: u.createdAt };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', async (request, reply) => {
    const body = signupBody.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw new HttpError(409, 'email_taken');

    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, name: body.name },
    });

    const token = app.jwt.sign({ userId: user.id });
    return reply.code(201).send({ user: publicUser(user), token });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new HttpError(401, 'invalid_credentials');

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) throw new HttpError(401, 'invalid_credentials');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = app.jwt.sign({ userId: user.id });
    return reply.send({ user: publicUser(user), token });
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      include: {
        memberships: {
          include: { organization: true },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!user) throw new HttpError(404, 'user_not_found');

    return {
      user: publicUser(user),
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
      })),
    };
  });
}
