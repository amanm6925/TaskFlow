// Per-file setup: provide the same env vars the app expects, using the
// globalSetup-provided TEST_DATABASE_URL. Runs before modules under test
// are imported, so PrismaClient sees the container URL at instantiation.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL!;
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test_jwt_secret_at_least_32_chars_long_xx';
process.env.ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL ?? '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = process.env.REFRESH_TOKEN_TTL_DAYS ?? '30';
process.env.NODE_ENV = 'test';
