import { randomUUID } from 'node:crypto';
import type { Tx } from './tenant.js';

export type TaskEventType = 'task.created' | 'task.updated' | 'task.deleted';

export type TaskEventPayload = {
  id: string;
  type: TaskEventType;
  orgId: string;
  projectId: string;
  projectKey: string;
  taskId: string;
  taskNumber?: number;
  title?: string;
  status?: string;
  reporterId?: string;
  assigneeId?: string | null;
};

/**
 * Emit a task event on the Postgres `task_events` channel via pg_notify.
 *
 * Called inside the same withTx that does the DB mutation — Postgres buffers
 * notifications and only delivers them at COMMIT. So if the tx rolls back,
 * the notification never fires. That gives us atomic "change + announce."
 *
 * 8KB payload limit on Postgres NOTIFY; task events are well under that.
 */
export async function emitTaskEvent(
  tx: Tx,
  event: Omit<TaskEventPayload, 'id'>,
): Promise<void> {
  const payload: TaskEventPayload = { id: randomUUID(), ...event };
  const json = JSON.stringify(payload);
  // $executeRaw parameterizes safely; no injection risk even if payload contained odd characters.
  await tx.$executeRaw`SELECT pg_notify('task_events', ${json})`;
}
