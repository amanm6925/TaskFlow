'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const { user, orgs, loading, refresh, logout } = useAuth();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/orgs', { method: 'POST', body: JSON.stringify({ name, slug }) });
      setName('');
      setSlug('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="p-8 text-zinc-500">loading…</div>;

  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold">dashboard</h1>
          <p className="text-xs text-zinc-500">{user.email}</p>
        </div>
        <button onClick={logout} className="text-xs text-zinc-400 hover:text-zinc-200">logout</button>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">your organizations</h2>
        {orgs.length === 0 ? (
          <p className="text-zinc-500 text-sm italic">no orgs yet — create one below</p>
        ) : (
          <ul className="space-y-1">
            {orgs.map((o) => (
              <li key={o.id} className="border border-zinc-800 rounded px-3 py-2 text-sm flex justify-between items-center">
                <Link href={`/orgs/${o.slug}`} className="hover:text-blue-400">
                  {o.name} <span className="text-zinc-500">/{o.slug}</span>
                </Link>
                <span className="text-xs text-zinc-500">{o.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={handleCreate} className="space-y-3 border border-zinc-800 rounded p-4">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">create organization</h2>
        <input placeholder="name" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
        <input placeholder="slug (a-z, 0-9, hyphens)" required pattern="[a-z0-9-]{3,50}" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-semibold text-sm">
          {busy ? 'creating…' : 'create org'}
        </button>
      </form>
    </main>
  );
}
