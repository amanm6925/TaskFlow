import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_URL_APP: z.string().url(),
  PORT: z.coerce.number().int().positive().default(3001),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  ANALYTICS_URL: z.string().url().default('http://localhost:3002'),
  INTERNAL_SERVICE_SECRET: z.string().min(16, 'INTERNAL_SERVICE_SECRET must be at least 16 chars'),
});

export const env = envSchema.parse(process.env);
