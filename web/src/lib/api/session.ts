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
  readonly credentialRevision: number;
  readonly expiresAt: number;
  readonly signal: AbortSignal;
}

/** Memory only: never reads/writes cookies, localStorage, URLs, or refresh tokens. */
export class MemorySession {
  #credentials: SessionCredentials | null = null;
  #status: 'anonymous' | 'expired' = 'anonymous';
  #revision = 0;
  #credentialRevision = 0;
  #rejectedCredentialRevision: number | null = null;
  #controller = new AbortController();
  #clock: () => number;
  #listeners = new Set<() => void>();
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;
  #notifying = false;

  constructor(clock: () => number = Date.now) { this.#clock = clock; }

  setCredentials(credentials: SessionCredentials): void {
    if (!credentials || typeof credentials.issuer !== 'string' || !credentials.issuer.trim()
      || typeof credentials.subject !== 'string' || !credentials.subject.trim()
      || typeof credentials.accessToken !== 'string'
      || !/^[A-Za-z0-9._~+/-]+=*$/.test(credentials.accessToken)
      || !Number.isFinite(credentials.expiresAt) || credentials.expiresAt <= this.#clock()) {
      throw new ApiError('invalid_input');
    }
    this.#expire();
    const next = { issuer: credentials.issuer, subject: credentials.subject,
      accessToken: credentials.accessToken, expiresAt: credentials.expiresAt };
    if (this.#credentials?.issuer === next.issuer && this.#credentials.subject === next.subject) {
      // A trusted refresh changes credentials, not the account or its accepted receipts.
      this.#credentials = next;
      this.#credentialRevision += 1;
      this.#rejectedCredentialRevision = null;
      this.#scheduleExpiry();
    } else this.#transition(next, 'anonymous');
  }

  clear(): void {
    this.#transition(null, 'anonymous');
  }

  /** Token-free invalidation signal for caller-owned protected views. */
  subscribe(listener: () => void): () => void {
    if (typeof listener !== 'function' || this.#listeners.size >= 32) throw new ApiError('invalid_input');
    this.#expire();
    this.#listeners.add(listener);
    this.#scheduleExpiry();
    return () => { this.#listeners.delete(listener); this.#scheduleExpiry(); };
  }

  #transition(credentials: SessionCredentials | null, status: 'anonymous' | 'expired', rejected: number | null = null): void {
    const oldController = this.#controller;
    this.#credentials = credentials;
    this.#status = status;
    this.#revision += 1;
    this.#credentialRevision += 1;
    this.#rejectedCredentialRevision = rejected;
    this.#controller = new AbortController();
    oldController.abort();
    if (!this.#notifying) {
      this.#notifying = true;
      try {
        for (const listener of [...this.#listeners]) {
          try { listener(); } catch { /* One view must not prevent other protected views clearing. */ }
        }
      } finally { this.#notifying = false; }
    }
    this.#scheduleExpiry();
  }

  #scheduleExpiry(): void {
    if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    if (!this.#credentials || this.#listeners.size === 0) return;
    const delay = Math.max(0, Math.min(this.#credentials.expiresAt - this.#clock(), 2_147_483_647));
    this.#expiryTimer = setTimeout(() => { this.#expire(); this.#scheduleExpiry(); }, delay);
    // Browser timers are numbers; native Node tests must not be held open by a session.
    (this.#expiryTimer as unknown as { unref?: () => void }).unref?.();
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
      credentialRevision: this.#credentialRevision,
      expiresAt: this.#credentials.expiresAt, signal: this.#controller.signal });
  }

  isCurrent(lease: SessionLease): boolean {
    this.#expire();
    return this.#credentials !== null && lease.revision === this.#revision;
  }

  invalidate(lease: SessionLease): void {
    if (this.isCredentialCurrent(lease)) this.#transition(null, 'anonymous', lease.credentialRevision);
  }
  isCredentialCurrent(lease: SessionLease): boolean {
    return this.isCurrent(lease) && lease.credentialRevision === this.#credentialRevision;
  }
  /** Token-free bookkeeping distinguishes verifier refusal from explicit sign-out. */
  wasInvalidated(lease: SessionLease): boolean { return this.#rejectedCredentialRevision === lease.credentialRevision; }
  remainingMs(lease: SessionLease): number {
    return this.isCurrent(lease) ? Math.max(0, this.#credentials!.expiresAt - this.#clock()) : 0;
  }

  #expire(): void {
    if (this.#credentials && this.#credentials.expiresAt <= this.#clock()) {
      this.#transition(null, 'expired');
    }
  }
}
