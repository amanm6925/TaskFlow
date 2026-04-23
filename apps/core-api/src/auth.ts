import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import jwtPlugin from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from './env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string };
    user: { userId: string };
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function signAccessToken(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ userId }, { jti: randomUUID() });
}

async function authPluginImpl(app: FastifyInstance) {
  await app.register(jwtPlugin, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.ACCESS_TOKEN_TTL },
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
  });
}

export const authPlugin = fp(authPluginImpl, { name: 'auth' });
