import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addMember,
  authHeader,
  closeTestApp,
  createOrg,
  createProject,
  getTestApp,
  resetDb,
  signupUser,
} from './helpers.js';
import { Role } from '@prisma/client';

beforeEach(async () => { await resetDb(); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await closeTestApp(); });

function mockFetchResponse(opts: { status: number; body?: string; headers?: Record<string, string> }) {
  const { status, body = '', headers = {} } = opts;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/csv; charset=utf-8', ...headers },
  });
}

describe('GET /api/projects/:projectId/export.csv', () => {
  it('proxies to analytics with the expected URL, secret, and user-id', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({
        status: 200,
        body: 'key,title\nSP-1,Seed',
        headers: { 'content-disposition': 'attachment; filename="SP-tasks.csv"' },
      })
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(owner.accessToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toBe('key,title\nSP-1,Seed');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toMatch(new RegExp(`/internal/reports/projects/${project.id}/tasks\\.csv$`));
    const headers = (calledInit?.headers ?? {}) as Record<string, string>;
    expect(headers['X-Internal-Auth']).toBe('test_internal_service_secret_xxx');
    expect(headers['X-User-Id']).toBe(owner.user.id);
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('forwards an inbound traceparent unchanged', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    const incomingTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ status: 200, body: 'key\n' })
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: { ...authHeader(owner.accessToken), traceparent: incomingTraceparent },
    });

    expect(res.statusCode).toBe(200);
    const headers = (fetchSpy.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;
    expect(headers.traceparent).toBe(incomingTraceparent);
  });

  it('returns 404 and does NOT call analytics when the user is not a member', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const outsider = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(outsider.accessToken),
    });

    expect(res.statusCode).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps analytics 404 → 404 project_not_found', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ status: 404 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(owner.accessToken),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('project_not_found');
  });

  it('maps analytics 401 → 502 upstream_misconfigured (does not leak to the user)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ status: 401 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(owner.accessToken),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_misconfigured');
  });

  it('maps analytics 5xx → 502 upstream_failure', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockFetchResponse({ status: 503 }));

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(owner.accessToken),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_failure');
  });

  it('maps analytics network error → 502 upstream_unavailable', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const org = await createOrg(owner.user.id);
    const project = await createProject(org.id, owner.user.id);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(owner.accessToken),
    });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('upstream_unavailable');
  });

  it('allows a VIEWER to export (read permission only)', async () => {
    const app = await getTestApp();
    const owner = await signupUser();
    const viewer = await signupUser();
    const org = await createOrg(owner.user.id);
    await addMember(viewer.user.id, org.id, Role.VIEWER);
    const project = await createProject(org.id, owner.user.id);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse({ status: 200, body: 'key,title\n' })
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/export.csv`,
      headers: authHeader(viewer.accessToken),
    });
    expect(res.statusCode).toBe(200);
  });
});
