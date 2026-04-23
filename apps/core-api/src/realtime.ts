import type { WebSocket } from 'ws';

export type SocketMeta = {
  userId: string;
  orgIds: Set<string>;
};

type TrackedSocket = WebSocket & { meta: SocketMeta };

const sockets = new Set<TrackedSocket>();

export function addSocket(socket: WebSocket, meta: SocketMeta) {
  const tracked = socket as TrackedSocket;
  tracked.meta = meta;
  sockets.add(tracked);
  socket.on('close', () => sockets.delete(tracked));
  socket.on('error', () => sockets.delete(tracked));
}

export type BroadcastEvent = {
  type: string;
  orgId: string;
  data: unknown;
};

/**
 * Deliver an event to every connected socket whose user is a member of the
 * event's org. Filters at the server; never send frames to other tenants.
 */
export function broadcast(event: BroadcastEvent) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState !== socket.OPEN) continue;
    if (!socket.meta.orgIds.has(event.orgId)) continue;
    socket.send(payload);
  }
}
