/**
 * Turns a Node process warning into a log line that says where it came from.
 *
 * Node prints warnings such as "MaxListenersExceededWarning: 11 close listeners added to
 * [ServerResponse]" or pg's "client.query() while already executing a query" deprecation with no
 * stack and no request, so production logs cannot tell which code caused them. The warning object
 * carries both: its stack points at the call that triggered it, and a MaxListeners warning holds
 * the emitter, which for an HTTP response leads to the request.
 */

export interface ProcessWarningLog {
  readonly message: string;
  readonly metadata: Record<string, unknown>;
}

interface MaxListenersWarning extends Error {
  emitter?: unknown;
  type?: unknown;
  count?: unknown;
}

/** Method and path (query string dropped: it can carry identifiers) of an HTTP response emitter. */
function requestOf(emitter: unknown): string | undefined {
  if (!emitter || typeof emitter !== 'object') return undefined;
  const req = (emitter as { req?: { method?: unknown; url?: unknown } }).req;
  if (!req || typeof req.url !== 'string') return undefined;
  const method = typeof req.method === 'string' ? req.method : '?';
  return `${method} ${req.url.split('?')[0]}`;
}

export function describeProcessWarning(warning: Error): ProcessWarningLog {
  const { emitter, type, count } = warning as MaxListenersWarning;
  const code = (warning as { code?: unknown }).code;
  const request = requestOf(emitter);
  return {
    message: `Process warning ${warning.name}: ${warning.message}`,
    metadata: {
      name: warning.name,
      ...(typeof code === 'string' && { code }),
      ...(typeof type === 'string' && { event: type }),
      ...(typeof count === 'number' && { listeners: count }),
      ...(emitter !== undefined && {
        emitter: (emitter as object)?.constructor?.name ?? typeof emitter,
      }),
      ...(request && { request }),
      stack: warning.stack,
    },
  };
}
