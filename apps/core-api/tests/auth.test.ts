import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestApp, getTestApp, loginUser, resetDb, signupUser } from './helpers.js';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeTestApp();
});

describe('POST /api/auth/signup', () => {
  it('creates a user and returns both tokens', async () => {
    const result = await signupUser({ email: 'alice@test.local' });
    expect(result.user.email).toBe('alice@test.local');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.accessToken).not.toBe(result.refreshToken);
  });

  it('rejects duplicate email with 409', async () => {
    const app = await getTestApp();
    await signupUser({ email: 'dup@test.local' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'dup@test.local', password: 'password1234', name: 'Other' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('email_taken');
  });
});

describe('POST /api/auth/login', () => {
  it('returns tokens for valid credentials', async () => {
    await signupUser({ email: 'bob@test.local', password: 'password1234' });
    const res = await loginUser('bob@test.local', 'password1234');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
  });

  it('rejects wrong password with 401', async () => {
    await signupUser({ email: 'carol@test.local', password: 'password1234' });
    const res = await loginUser('carol@test.local', 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('rejects unknown email with 401', async () => {
    const res = await loginUser('nobody@test.local', 'whatever');
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/me', () => {
  it('returns 401 without a token', async () => {
    const app = await getTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns user profile with a valid access token', async () => {
    const { accessToken, user } = await signupUser({ email: 'dan@test.local' });
    const app = await getTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(user.id);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and returns a new access token', async () => {
    const app = await getTestApp();
    const { refreshToken: initialRefresh, accessToken: initialAccess } = await signupUser();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: initialRefresh },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.refreshToken).toBeTruthy();
    expect(body.refreshToken).not.toBe(initialRefresh);
    expect(body.accessToken).toBeTruthy();
    expect(body.accessToken).not.toBe(initialAccess);
  });

  it('reuse of a rotated refresh token revokes the entire family', async () => {
    const app = await getTestApp();
    const { refreshToken: r1 } = await signupUser();

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: r1 },
    });
    const r2 = first.json().refreshToken as string;

    // Reuse the already-rotated r1 — should trigger family revoke.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: r1 },
    });
    expect(reuse.statusCode).toBe(401);

    // The still-fresh r2 must now also be dead.
    const afterFamilyRevoke = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: r2 },
    });
    expect(afterFamilyRevoke.statusCode).toBe(401);
  });

  it('rejects an unknown refresh token with 401', async () => {
    const app = await getTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token and subsequent refresh attempts 401', async () => {
    const app = await getTestApp();
    const { refreshToken } = await signupUser();

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const refreshAttempt = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshAttempt.statusCode).toBe(401);
  });
});
