import { ApiError } from './errors.ts';

/** Supplied by a trusted OIDC integration. This module does not verify JWTs or sign in. */
export interface SessionCredentials {
  issuer: string;
  subject: string;
  accessToken: string;
  expiresAt: number;
}
export type SessionSnapshot = { status: 'anonymous' | 'expired' }
  | { status: 'authenticated'; issuer: string; subject: string; expiresAt: number };
export interface SessionLease {
  readonly authorization: string;
  readonly revision: number;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
}

/** Memory only: never reads/writes cookies, localStorage, URLs, or refresh tokens. */
export class MemorySession {
  #credentials: SessionCredentials | null = null;
  #status: 'anonymous' | 'expired' = 'anonymous';
  #revision = 0;
  #controller = new AbortController();
  #clock: () => number;

  constructor(clock: () => number = Date.now) { this.#clock = clock; }

  setCredentials(credentials: SessionCredentials): void {
    if (!credentials || typeof credentials.issuer !== 'string' || !credentials.issuer.trim()
      || typeof credentials.subject !== 'string' || !credentials.subject.trim()
      || typeof credentials.accessToken !== 'string'
      || !/^[A-Za-z0-9._~+/-]+=*$/.test(credentials.accessToken)
      || !Number.isFinite(credentials.expiresAt) || credentials.expiresAt <= this.#clock()) {
      throw new ApiError('invalid_input');
    }
    this.clear();
    this.#credentials = { issuer: credentials.issuer, subject: credentials.subject,
      accessToken: credentials.accessToken, expiresAt: credentials.expiresAt };
  }

  clear(): void {
    this.#credentials = null;
    this.#status = 'anonymous';
    this.#revision += 1;
    this.#controller.abort();
    this.#controller = new AbortController();
  }

  snapshot(): SessionSnapshot {
    this.#expire();
    const c = this.#credentials;
    return c ? { status: 'authenticated', issuer: c.issuer, subject: c.subject, expiresAt: c.expiresAt }
      : { status: this.#status };
  }

  /** Transport-only credential lease. Never persist or log it. */
  capture(): SessionLease {
    this.#expire();
    if (!this.#credentials) throw new ApiError(this.#status === 'expired' ? 'session_expired' : 'unauthenticated');
    return Object.freeze({ authorization: `Bearer ${this.#credentials.accessToken}`, revision: this.#revision,
      expiresAt: this.#credentials.expiresAt, signal: this.#controller.signal });
  }

  isCurrent(lease: SessionLease): boolean {
    this.#expire();
    return this.#credentials !== null && lease.revision === this.#revision;
  }

  invalidate(lease: SessionLease): void { if (this.isCurrent(lease)) this.clear(); }
  remainingMs(lease: SessionLease): number { return Math.max(0, lease.expiresAt - this.#clock()); }

  #expire(): void {
    if (this.#credentials && this.#credentials.expiresAt <= this.#clock()) {
      this.clear();
      this.#status = 'expired';
    }
  }
}
