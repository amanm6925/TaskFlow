'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type Member = {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  joinedAt: string;
};

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

export default function MembersPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const { user, orgs, loading } = useAuth();
  const org = orgs.find((o) => o.slug === slug);

  const [members, setMembers] = useState<Member[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('MEMBER');
  const [inviting, setInviting] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  const refresh = useCallback(async () => {
    if (!org) return;
    try {
      const data = await api<Member[]>(`/api/orgs/${org.id}/members`);
      setMembers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'failed to load');
    } finally {
      setListLoading(false);
    }
  }, [org]);

  useEffect(() => { refresh(); }, [refresh]);

  const isPrivileged = org?.role === 'OWNER' || org?.role === 'ADMIN';
  const isOwner = org?.role === 'OWNER';
  const ownerCount = members.filter((m) => m.role === 'OWNER').length;

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setInviting(true);
    setError(null);
    try {
      await api(`/api/orgs/${org.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteEmail('');
      setInviteRole('MEMBER');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'invite failed');
    } finally {
      setInviting(false);
    }
  }

  async function handleRoleChange(member: Member, newRole: Role) {
    if (!org || newRole === member.role) return;
    setError(null);
    try {
      await api(`/api/orgs/${org.id}/members/${member.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'role change failed');
      await refresh();
    }
  }

  async function handleRemove(member: Member) {
    if (!org) return;
    if (!confirm(`remove ${member.email} from ${org.name}?`)) return;
    setError(null);
    try {
      await api(`/api/orgs/${org.id}/members/${member.userId}`, { method: 'DELETE' });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'remove failed');
    }
  }

  function rolesAvailableForChange(target: Member): Role[] {
    if (!isPrivileged) return [target.role];
    return ROLES.filter((r) => {
      if (r === 'OWNER' && !isOwner) return false;
      if (target.role === 'OWNER' && r !== 'OWNER' && ownerCount <= 1) return false;
      return true;
    });
  }

  function canRemove(target: Member): boolean {
    if (!isPrivileged) return false;
    if (target.role === 'OWNER' && !isOwner) return false;
    if (target.role === 'OWNER' && ownerCount <= 1) return false;
    return true;
  }

  if (loading) return <div className="p-8 text-zinc-500">loading…</div>;
  if (!org) return <div className="p-8 text-red-400">org not found or you are not a member</div>;

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <Link href={`/orgs/${slug}`} className="text-xs text-zinc-500 hover:text-zinc-200">← {org.name}</Link>
        <h1 className="text-xl font-bold mt-1">members</h1>
        <p className="text-xs text-zinc-500">your role: {org.role}</p>
      </header>

      {error && (
        <p className="text-red-400 text-xs border border-red-900 bg-red-950/30 rounded px-3 py-2">{error}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">members ({members.length})</h2>
        {listLoading ? (
          <p className="text-zinc-500 text-sm italic">loading…</p>
        ) : (
          <ul className="space-y-1">
            {members.map((m) => {
              const isSelf = m.userId === user?.id;
              const availableRoles = rolesAvailableForChange(m);
              const canChangeRole = isPrivileged && availableRoles.length > 1;
              return (
                <li key={m.userId} className="border border-zinc-800 rounded px-3 py-2 text-sm flex items-center gap-3">
                  <span className="flex-1">
                    <span>{m.name}</span>{' '}
                    <span className="text-zinc-500 text-xs">{m.email}</span>
                    {isSelf && <span className="ml-2 text-xs text-blue-400">(you)</span>}
                  </span>
                  {canChangeRole ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                    >
                      {availableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-zinc-500">{m.role}</span>
                  )}
                  {canRemove(m) && (
                    <button
                      onClick={() => handleRemove(m)}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
                      title="remove from org"
                    >
                      remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isPrivileged && (
        <form onSubmit={handleInvite} className="space-y-3 border border-zinc-800 rounded p-4">
          <h2 className="text-sm uppercase tracking-wider text-zinc-400">invite member</h2>
          <p className="text-xs text-zinc-500">
            the user must already have a TaskFlow account. enter their email below.
          </p>
          <input
            type="email"
            placeholder="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
          >
            {ROLES.filter((r) => r !== 'OWNER' || isOwner).map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={inviting}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-semibold text-sm"
          >
            {inviting ? 'inviting…' : 'invite'}
          </button>
        </form>
      )}
    </main>
  );
}
