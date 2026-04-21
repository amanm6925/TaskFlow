import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { env } from './env.js';
import { authPlugin } from './auth.js';
import { addSocket } from './realtime.js';
import { HttpError } from './permissions.js';
import { authRoutes } from './routes/auth.js';
import { orgRoutes } from './routes/orgs.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: 'http://localhost:3000',
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

app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => addSocket(socket));
});

await app.listen({ port: env.PORT, host: '0.0.0.0' });
