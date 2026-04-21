import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { WebSocket } from 'ws';

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const sockets = new Set<WebSocket>();

function broadcast(event: unknown) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

await app.register(cors, { origin: 'http://localhost:3000' });
await app.register(websocket);

app.get('/health', async () => ({ ok: true }));

app.get('/api/clicks', async () => {
  return prisma.click.findMany({ orderBy: { id: 'asc' } });
});

const createClickBody = z.object({ message: z.string().min(1).max(280) });

app.post('/api/clicks', async (request, reply) => {
  const parsed = createClickBody.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_body', details: parsed.error.issues });
  }

  const click = await prisma.click.create({ data: { message: parsed.data.message } });
  broadcast({ type: 'click.created', data: click });
  return reply.code(201).send({ ok: true });
});

app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
});

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: '0.0.0.0' });
