'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError, getAccessToken, getWsUrl } from '@/lib/api';

type Project = { id: string; name: string; key: string; organizationId: string };
type Task = {
  id: string;
  number: number;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  reporterId: string;
  assigneeId: string | null;
  reporter?: { name: string };
  assignee?: { name: string } | null;
  projectId: string;
};

const STATUSES: Task['status'][] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED'];

export default function ProjectPage({ params }: { params: { slug: string; key: string } }) {
  const { slug, key } = params;
  const router = useRouter();
  const { user, orgs, loading } = useAuth();
  const org = orgs.find((o) => o.slug === slug);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { if (!loading && !user) router.replace('/login'); }, [loading, user, router]);

  useEffect(() => {
    if (!org) return;
    (async () => {
      try {
        const projects = await api<Project[]>(`/api/orgs/${org.id}/projects`);
        const found = projects.find((p) => p.key === key);
        if (!found) { setError('project not found'); return; }
        setProject(found);
        const t = await api<Task[]>(`/api/projects/${found.id}/tasks`);
        setTasks(t);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'failed to load');
      }
    })();
  }, [org, key]);

  useEffect(() => {
    if (!project || !getAccessToken()) return;
    const url = getWsUrl();
    if (!url) return;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setWsStatus('open');
    ws.onclose = () => setWsStatus('closed');
    ws.onerror = () => setWsStatus('closed');
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data) as { type: string; data: Task & { id: string } };
      if (msg.type === 'task.created' && msg.data.projectId === project.id) {
        setTasks((prev) => prev.some((t) => t.id === msg.data.id) ? prev : [...prev, msg.data]);
      } else if (msg.type === 'task.updated' && msg.data.projectId === project.id) {
        setTasks((prev) => prev.map((t) => t.id === msg.data.id ? { ...t, ...msg.data } : t));
      } else if (msg.type === 'task.deleted' && (msg.data as unknown as { projectId: string }).projectId === project.id) {
        setTasks((prev) => prev.filter((t) => t.id !== msg.data.id));
      }
    };
    return () => ws.close();
  }, [project]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      await api<Task>(`/api/projects/${project.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
      setTitle('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(task: Task, newStatus: Task['status']) {
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'update failed');
    }
  }

  if (loading) return <div className="p-8 text-zinc-500">loading…</div>;
  if (!org) return <div className="p-8 text-red-400">org not found</div>;
  if (!project && !error) return <div className="p-8 text-zinc-500">loading project…</div>;

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <header>
        <Link href={`/orgs/${slug}`} className="text-xs text-zinc-500 hover:text-zinc-200">← {org.name}</Link>
        <div className="flex items-baseline justify-between mt-1">
          <h1 className="text-xl font-bold">{project ? `${project.key} · ${project.name}` : 'project'}</h1>
          <span className={`text-xs ${wsStatus === 'open' ? 'text-green-400' : wsStatus === 'connecting' ? 'text-yellow-400' : 'text-red-400'}`}>WS: {wsStatus}</span>
        </div>
      </header>

      {project && org.role !== 'VIEWER' && (
        <form onSubmit={handleCreate} className="flex gap-2">
          <input placeholder="new task title" required value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm" />
          <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-white font-semibold text-sm">
            {busy ? '…' : 'add'}
          </button>
        </form>
      )}
      {error && <p className="text-red-400 text-xs">{error}</p>}

      <section className="space-y-2">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">tasks ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="text-zinc-500 text-sm italic">no tasks yet</p>
        ) : (
          <ul className="space-y-1">
            {tasks.map((t) => (
              <li key={t.id} className="border border-zinc-800 rounded px-3 py-2 text-sm flex items-center gap-3">
                <span className="text-zinc-500 font-bold">{project?.key}-{t.number}</span>
                <span className="flex-1">{t.title}</span>
                <span className="text-xs text-zinc-500">{t.assignee?.name ?? 'unassigned'}</span>
                <select
                  value={t.status}
                  onChange={(e) => changeStatus(t, e.target.value as Task['status'])}
                  disabled={org.role === 'VIEWER'}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
