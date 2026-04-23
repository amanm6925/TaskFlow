import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

/**
 * W3C Trace Context `traceparent` header utilities.
 * Format: 00-<32 hex trace-id>-<16 hex span-id>-<2 hex flags>
 *
 * If the inbound request already carries a valid traceparent, we forward it
 * (we are a participant in an existing trace). Otherwise we mint a new one so
 * downstream services have something to correlate on.
 *
 * Future OpenTelemetry wiring will consume these automatically.
 */
const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;

export function readOrMakeTraceparent(request: FastifyRequest): string {
  const incoming = request.headers.traceparent;
  if (typeof incoming === 'string' && TRACEPARENT_RE.test(incoming)) {
    return incoming;
  }
  return makeTraceparent();
}

export function makeTraceparent(): string {
  const traceId = randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  return `00-${traceId}-${spanId}-01`;
}
