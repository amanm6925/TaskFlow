'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 border border-zinc-800 rounded p-6">
        <h1 className="text-xl font-bold">log in</h1>
        <label className="block">
          <span className="text-xs text-zinc-400">email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 mt-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400">password</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 mt-1 text-sm" />
        </label>
        {error && <p className="text-red-400 text-xs">{error}</p>}
        <button type="submit" disabled={busy} className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-semibold text-sm">
          {busy ? 'logging in…' : 'log in'}
        </button>
        <p className="text-xs text-zinc-500">no account? <Link href="/signup" className="text-blue-400 hover:underline">sign up</Link></p>
      </form>
    </main>
  );
}
