import { env } from './env.js';

export type AnalyticsFetchInput = {
  userId: string;
  traceparent: string;
};

/**
 * Call the analytics service's tasks-CSV endpoint. Returns the raw Response so
 * the caller can stream the body back to the client without buffering.
 */
export async function fetchTasksCsv(
  projectId: string,
  input: AnalyticsFetchInput,
): Promise<Response> {
  const url = `${env.ANALYTICS_URL}/internal/reports/projects/${projectId}/tasks.csv`;
  return fetch(url, {
    method: 'GET',
    headers: {
      'X-Internal-Auth': env.INTERNAL_SERVICE_SECRET,
      'X-User-Id': input.userId,
      traceparent: input.traceparent,
    },
    // Node fetch has no default timeout; use AbortSignal.timeout for a bounded wait.
    // 30s accommodates large CSVs while still failing fast on a hung upstream.
    signal: AbortSignal.timeout(30_000),
  });
}
