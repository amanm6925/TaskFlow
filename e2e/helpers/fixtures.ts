import { API_BASE } from '../playwright.config';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

function bearer(token: string) {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

let fixtureCounter = 0;

export async function createOrg(
  token: string,
  overrides: { name?: string; slug?: string } = {},
): Promise<{ id: string; name: string; slug: string; role: Role }> {
  fixtureCounter += 1;
  const stamp = Date.now().toString().slice(-6);
  const name = overrides.name ?? `Org ${fixtureCounter}`;
  const slug = overrides.slug ?? `org-${fixtureCounter}-${stamp}`;
  const res = await fetch(`${API_BASE}/api/orgs`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ name, slug }),
  });
  if (!res.ok) throw new Error(`createOrg failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function inviteMember(
  ownerToken: string,
  orgId: string,
  email: string,
  role: Role = 'MEMBER',
): Promise<{ userId: string; role: Role }> {
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/members`, {
    method: 'POST',
    headers: bearer(ownerToken),
    body: JSON.stringify({ email, role }),
  });
  if (!res.ok) throw new Error(`inviteMember failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function createProject(
  token: string,
  orgId: string,
  overrides: { name?: string; key?: string } = {},
): Promise<{ id: string; name: string; key: string }> {
  fixtureCounter += 1;
  const stamp = Date.now().toString().slice(-5);
  const name = overrides.name ?? `Project ${fixtureCounter}`;
  const rawKey = overrides.key ?? `P${fixtureCounter}${stamp}`;
  const key = rawKey.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  const res = await fetch(`${API_BASE}/api/orgs/${orgId}/projects`, {
    method: 'POST',
    headers: bearer(token),
    body: JSON.stringify({ name, key }),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status} ${await res.text()}`);
  return res.json();
}
