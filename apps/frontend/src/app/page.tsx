'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [user, loading, router]);
  return <div className="p-8 text-zinc-500">loading…</div>;
}
