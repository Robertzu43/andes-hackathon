export type ErrorKind = 'configuration' | 'invalid_input' | 'unauthenticated' | 'session_expired'
  | 'session_changed' | 'forbidden' | 'not_found' | 'conflict' | 'unsupported'
  | 'server' | 'http' | 'network' | 'cancelled' | 'timeout' | 'invalid_response';
export type WriteOutcome = 'not_sent' | 'rejected' | 'unknown' | 'not_applicable';

const messages: Record<ErrorKind, string> = {
  configuration: 'Configure a trusted HTTPS API URL or a local development endpoint.',
  invalid_input: 'Check the request fields and idempotency key.',
  unauthenticated: 'A verified identity session is required.',
  session_expired: 'The identity session expired. Sign in through the configured identity provider.',
  session_changed: 'The identity session changed. Reload this view before continuing.',
  forbidden: 'This account does not have current permission for this operation.',
  not_found: 'The requested resource was not found.',
  conflict: 'The request conflicts with current state. Read the current state before continuing.',
  unsupported: 'This operation or input is not supported by the server.',
  server: 'The server could not confirm the result. Check the current state before continuing.',
  http: 'The server rejected the request.',
  network: 'The connection failed. A submitted write may already have committed.',
  cancelled: 'The request was cancelled locally. This does not undo a submitted write.',
  timeout: 'The request timed out locally. A submitted write may already have committed.',
  invalid_response: 'The server returned an unexpected response. Check the current state before continuing.',
};

export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly operation: string;
  readonly outcome: WriteOutcome;

  constructor(kind: ErrorKind, options: {
    status?: number; code?: string; operation?: string; outcome?: WriteOutcome;
  } = {}) {
    super(messages[kind]);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? kind;
    this.operation = options.operation ?? 'session';
    this.outcome = options.outcome ?? 'not_sent';
  }
}
