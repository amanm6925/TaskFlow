'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';

type Project = { id: string; name: string; key: string; description: string | null; createdAt: string };

export default function OrgPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  const router = useRouter();
  const { user, orgs, loading } = useAuth();
  const org = orgs.find((o) => o.slug === slug);

  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  useEffect(() => {
    if (!org) return;
    api<Project[]>(`/api/orgs/${org.id}/projects`)
      .then(setProjects)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'failed to load'))
      .finally(() => setListLoading(false));
  }, [org]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<Project>(`/api/orgs/${org.id}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name, key }),
      });
      setProjects((prev) => [...prev, created]);
      setName('');
      setKey('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="p-8 text-zinc-500">loading…</div>;
  if (!org) return <div className="p-8 text-red-400">org not found or you are not a member</div>;

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <Link href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-200">← dashboard</Link>
        <div className="flex items-baseline justify-between mt-1">
          <h1 className="text-xl font-bold">{org.name}</h1>
          <Link href={`/orgs/${slug}/members`} className="text-xs text-blue-400 hover:underline">manage members →</Link>
        </div>
        <p className="text-xs text-zinc-500">/{org.slug} · your role: {org.role}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">projects</h2>
        {listLoading ? (
          <p className="text-zinc-500 text-sm italic">loading…</p>
        ) : projects.length === 0 ? (
          <p className="text-zinc-500 text-sm italic">no projects yet</p>
        ) : (
          <ul className="space-y-1">
            {projects.map((p) => (
              <li key={p.id} className="border border-zinc-800 rounded px-3 py-2 text-sm">
                <Link href={`/orgs/${slug}/projects/${p.key}`} className="hover:text-blue-400">
                  <span className="text-zinc-500">{p.key}</span> {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {org.role !== 'VIEWER' && (
        <form onSubmit={handleCreate} className="space-y-3 border border-zinc-800 rounded p-4">
          <h2 className="text-sm uppercase tracking-wider text-zinc-400">create project</h2>
          <input placeholder="name" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
          <input placeholder="key (e.g. ENG)" required pattern="[A-Z0-9]{2,10}" value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-semibold text-sm">
            {busy ? 'creating…' : 'create project'}
          </button>
        </form>
      )}
    </main>
  );
}
