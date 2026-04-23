import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, signAccessToken, verifyPassword } from '../auth.js';
import { HttpError } from '../permissions.js';
import { withTx } from '../tenant.js';
import {
  issueRefreshToken,
  rotateRefreshToken,
  revokeByRawToken,
  type TokenMeta,
} from '../tokens.js';

const signupBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
});

const loginBody = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

const refreshBody = z.object({
  refreshToken: z.string().min(1),
});

const logoutBody = z.object({
  refreshToken: z.string().min(1),
});

function publicUser(u: { id: string; email: string; name: string; avatarUrl: string | null; createdAt: Date }) {
  return { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl, createdAt: u.createdAt };
}

function metaFromRequest(request: FastifyRequest): TokenMeta {
  const ua = request.headers['user-agent'];
  return {
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null,
    ipAddress: request.ip ?? null,
  };
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

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = await issueRefreshToken(user.id, metaFromRequest(request));
    return reply.code(201).send({ user: publicUser(user), accessToken, refreshToken });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw new HttpError(401, 'invalid_credentials');

    const ok = await verifyPassword(user.passwordHash, body.password);
    if (!ok) throw new HttpError(401, 'invalid_credentials');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const accessToken = signAccessToken(app, user.id);
    const refreshToken = await issueRefreshToken(user.id, metaFromRequest(request));
    return reply.send({ user: publicUser(user), accessToken, refreshToken });
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const body = refreshBody.parse(request.body);

    const result = await rotateRefreshToken(body.refreshToken, metaFromRequest(request));
    if (!result.ok) {
      request.log.info({ reason: result.reason }, 'refresh_rejected');
      throw new HttpError(401, 'invalid_refresh');
    }

    const accessToken = signAccessToken(app, result.userId);
    return reply.send({ accessToken, refreshToken: result.raw });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const body = logoutBody.parse(request.body);
    await revokeByRawToken(body.refreshToken);
    return reply.code(204).send();
  });

  app.get('/api/me', { preHandler: app.authenticate }, async (request) => {
    return withTx(request.user.userId, async (tx) => {
      const user = await tx.user.findUnique({
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
  });
}
