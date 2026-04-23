import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from './env.js';
import { authPlugin } from './auth.js';
import { prismaAdmin } from './db.js';
import { addSocket } from './realtime.js';
import { HttpError } from './permissions.js';
import { authRoutes } from './routes/auth.js';
import { orgRoutes } from './routes/orgs.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';

export type BuildAppOptions = { logger?: boolean };

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  await app.register(websocket);
  await app.register(authPlugin);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'invalid_input', issues: error.issues });
    }
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.code, message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') return reply.code(409).send({ error: 'conflict' });
      if (error.code === 'P2025') return reply.code(404).send({ error: 'not_found' });
    }
    app.log.error(error);
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(orgRoutes);
  await app.register(projectRoutes);
  await app.register(taskRoutes);

  await app.register(async (instance) => {
    // Browsers can't set Authorization headers on WebSocket connections,
    // so we pass the access token as a query param. Short-lived token + wss://
    // keeps the leak surface (access logs) acceptable.
    instance.get('/ws', {
      websocket: true,
      preValidation: async (request, reply) => {
        const token = (request.query as { token?: string }).token;
        if (!token) return reply.code(401).send({ error: 'token_required' });
        try {
          const decoded = app.jwt.verify<{ userId: string }>(token);
          (request as unknown as { userId: string }).userId = decoded.userId;
        } catch {
          return reply.code(401).send({ error: 'invalid_token' });
        }
      },
    }, async (socket, request) => {
      const userId = (request as unknown as { userId: string }).userId;
      // Admin client: socket bootstrap is infrastructure, not request-scoped tenant access.
      const memberships = await prismaAdmin.membership.findMany({
        where: { userId },
        select: { organizationId: true },
      });
      addSocket(socket, {
        userId,
        orgIds: new Set(memberships.map((m) => m.organizationId)),
      });
    });
  });

  return app;
}
