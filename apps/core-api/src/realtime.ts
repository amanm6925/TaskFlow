import type { WebSocket } from 'ws';

const sockets = new Set<WebSocket>();

export function addSocket(socket: WebSocket) {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => sockets.delete(socket));
}

export function broadcast(event: { type: string; data: unknown }) {
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
