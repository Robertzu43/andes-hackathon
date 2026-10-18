// Upload bridge: drains the durable queue onto
// POST /v1/trips/:id/locations from the backend runtime contract
// (docs/contracts/runtime.md on main):
//   - owner-only Bearer OIDC JWT; every POST requires Idempotency-Key
//     (1-128 visible ASCII, scoped actor/method/route/params; same key +
//     same content replays the persisted response, changed content -> 409)
//   - body { observations: [{ capturedAt ISO date-time, latitude, longitude,
//     accuracy }] }, 1..100 items
//   - errors are { code }: 400 invalid_request | capture_time_out_of_bounds
//     (>24h old or >30s future), 401 unauthorized, 403 forbidden (not the
//     owner), 404 trip_not_found, 409 location_stopped (trip closed) |
//     idempotency_conflict, 500 internal_error
//   - success: { id, received }
//
// Upload acceptance is a server receipt fact, validated against the request
// (trip id + sample count) before anything is deleted locally. It is never a
// freshness, liveness or trip-health signal, and this module never fabricates
// one. Once a request may have reached the server (network failure, 5xx,
// unverifiable receipt), the SAME batch content retries under the SAME
// idempotency key until acknowledged — it is never silently regrouped.

import { QUEUE_LIMITS } from './queue.mjs';

const DEFAULTS = Object.freeze({
  batchSize: QUEUE_LIMITS.batchMax,
  maxAttempts: 8,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  requestTimeoutMs: 15_000,
  maxBatchesPerFlush: 10,
});

// Codes that reject the batch for good. Anything else that is not a valid
// receipt is retried (unknown 4xx, a route-not-found 404, 408, 429, 5xx).
const PERMANENT = Object.freeze({ trip_not_found: 'rejectedMissing', idempotency_conflict: 'conflictErrors' });
// Codes that reject the whole batch because of (at least) one sample: the
// batch is halved until the offending sample is isolated.
const PER_SAMPLE = Object.freeze({ invalid_request: 'rejectedValidation', capture_time_out_of_bounds: 'rejectedBounds' });
const ABORTED = Symbol('aborted');

async function sha256Hex(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The bearer token's `sub` claim, decoded but not verified (the server
// verifies). null when the token is not a JWT with a string subject.
function tokenSubject(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { sub } = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))));
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

export function createLocationUploader({
  queue,
  baseUrl,
  getAccessToken,
  fetchImpl = typeof fetch === 'function' ? fetch.bind(globalThis) : null,
  digest = sha256Hex,
  timers = globalThis,
  onlineTarget = null,
  batchSize = DEFAULTS.batchSize,
  maxAttempts = DEFAULTS.maxAttempts,
  baseBackoffMs = DEFAULTS.baseBackoffMs,
  maxBackoffMs = DEFAULTS.maxBackoffMs,
  requestTimeoutMs = DEFAULTS.requestTimeoutMs,
  maxBatchesPerFlush = DEFAULTS.maxBatchesPerFlush,
}) {
  if (!queue) throw new TypeError('queue is required');
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) throw new TypeError('baseUrl must be an https URL');
  if (typeof getAccessToken !== 'function') throw new TypeError('getAccessToken is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  for (const [name, value] of Object.entries({ batchSize, maxAttempts, baseBackoffMs, maxBackoffMs, requestTimeoutMs, maxBatchesPerFlush })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`);
  }
  if (batchSize > QUEUE_LIMITS.batchMax) throw new RangeError(`batchSize cannot exceed the server maximum ${QUEUE_LIMITS.batchMax}`);
  const origin = baseUrl.replace(/\/+$/, '');

  let inFlight = null;
  let stopped = false;
  let pumpState = 'idle'; // idle | uploading | auth-blocked | stopped
  let consecutiveFailures = 0;
  let lastError = null;
  let lastReceipt = null; // { tripId, received } — a validated receipt fact, nothing more
  let retryTimer = null;
  let owner = null; // the subject whose records this uploader may send
  let request = null; // AbortController of the request on the wire

  // Same batch content -> same key, so a reconnect retry replays the server's
  // persisted response instead of double-inserting. 69 visible ASCII chars.
  async function idempotencyKey(tripId, samples) {
    const canonical = JSON.stringify({ v: 1, route: 'locations', tripId, samples });
    return `loc1-${await digest(canonical)}`;
  }

  function scheduleRetry(userId) {
    consecutiveFailures += 1;
    if (retryTimer !== null || stopped) return;
    const backoffMs = Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.max(0, consecutiveFailures - 1));
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (!stopped) flush({ userId }).catch(() => {});
    }, backoffMs);
  }

  // Not delivered: back to pending and retry with backoff. countAttempt
  // spends retry budget (exhausted records are retained as failed and the
  // intent dropped); network errors never do, so being offline cannot fail a
  // sample. pin persists { samples, key } as the durable intent when the
  // server may already hold the batch.
  async function retryLater(scope, records, code, userId, { countAttempt = true, pin = null } = {}) {
    const queueIds = records.map((r) => r.queueId);
    const updated = countAttempt ? await queue.noteAttempt(queueIds, code) : await queue.getRecords(queueIds);
    const exhausted = updated.filter((record) => record.attempts >= maxAttempts);
    if (exhausted.length > 0) {
      await queue.markFailed(exhausted, code);
      await queue.releaseBatch(updated.filter((record) => record.attempts < maxAttempts), code, { countAttempt: false });
      await queue.clearStickyIntent(scope);
    } else {
      if (pin) await queue.setStickyIntent(scope, { ...pin, queueIds, sessionId: records[0]?.sessionId ?? null });
      await queue.releaseBatch(records, code, { countAttempt: false });
    }
    lastError = code;
    scheduleRetry(userId);
  }

  // Sends one batch for the scope. Returns true to continue with the next
  // batch of the same scope, false when the scope is done for this flush.
  async function uploadBatch(scope, userId, ctx) {
    let samples;
    let key;
    const stuck = await queue.stickyIntent(scope);
    if (stuck) {
      ctx.records = await queue.getRecords(stuck.queueIds);
      samples = stuck.intent.body.observations;
      const replayable = ctx.records.length === stuck.queueIds.length
        && ctx.records.every((record) => record.capturedAtMs >= queue.nowMs() - QUEUE_LIMITS.captureWindowMs + QUEUE_LIMITS.sendMarginMs);
      if (!replayable) {
        // Wiped, or a sample aged toward the window edge: the original body
        // can no longer be replayed byte-identically. Drop the intent;
        // takeBatch regroups the survivors under a new key (the server keeps
        // the first sample per capture time, so a repeat is harmless).
        await queue.clearStickyIntent(scope);
        return true;
      }
      key = stuck.intent.key;
    } else {
      ctx.records = await queue.takeBatch({ ...scope, limit: ctx.limit });
      if (ctx.records.length === 0) return false;
      samples = ctx.records.map((record) => record.sample);
      key = await idempotencyKey(scope.tripId, samples);
    }
    const { records } = ctx;
    const release = (code) => queue.releaseBatch(records, code, { countAttempt: false });

    let token;
    try {
      token = await getAccessToken();
    } catch {
      token = null;
    }
    const present = await queue.getRecords(records.map((r) => r.queueId));
    if (present.length !== records.length) {
      await queue.releaseBatch(present, 'wiped', { countAttempt: false });
      await queue.clearStickyIntent(scope);
      return true;
    }
    if (typeof token !== 'string' || token.length === 0) {
      // No request was sent, so no intent is ambiguous; safe to regroup.
      await release('auth-unavailable');
      await queue.clearStickyIntent(scope);
      pumpState = 'auth-blocked';
      lastError = 'auth-unavailable';
      return false;
    }
    if (tokenSubject(token) !== scope.userId) {
      // Never send one owner's samples with another identity's credentials.
      await release('token-owner-mismatch');
      pumpState = 'auth-blocked';
      lastError = 'token-owner-mismatch';
      return false;
    }

    // FINAL retirement gate: synchronous, after the last await, immediately
    // before the request fires. Nothing may await between it and fetch.
    if (stopped || queue.isScopeRevoked(scope)) {
      await release('stopped');
      return false;
    }
    const controller = new AbortController();
    request = controller;
    const aborted = new Promise((resolve) => controller.signal.addEventListener('abort', () => resolve(ABORTED), { once: true }));
    // The timeout covers the response body too: a stalled body cannot hang
    // the shared flush.
    const timeout = timers.setTimeout(() => controller.abort(), requestTimeoutMs);
    let response = null;
    let body = null;
    try {
      response = await Promise.race([fetchImpl(`${origin}/v1/trips/${encodeURIComponent(scope.tripId)}/locations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ observations: samples }),
        signal: controller.signal,
      }), aborted]);
      if (response === ABORTED) response = null;
      else body = await Promise.race([Promise.resolve().then(() => response.json()).catch(() => null), aborted.then(() => null)]);
    } catch {
      response = null;
    } finally {
      timers.clearTimeout(timeout);
      if (request === controller) request = null;
    }

    // Post-request retirement gate: a stop()/signOut()/revokeTrip() that ran
    // while the request was in flight means NO delivery side effects — no
    // receipt write, no deletion, no counters, no new durable intent.
    // Records settle back to pending (a no-op if a wipe deleted them).
    if (stopped || queue.isScopeRevoked(scope)) {
      await release('stopped');
      return false;
    }
    if (!response) {
      // Network failure or timeout: ambiguous, but being offline never
      // spends retry budget.
      await retryLater(scope, records, 'network-error', userId, { countAttempt: false, pin: { samples, key } });
      return false;
    }

    const { status } = response;
    if (status >= 200 && status < 300) {
      if (body && body.id === scope.tripId && body.received === samples.length) {
        await queue.confirmUploaded(records);
        await queue.clearStickyIntent(scope);
        consecutiveFailures = 0;
        lastReceipt = { tripId: scope.tripId, received: body.received };
        return true;
      }
      // A 2xx that does not echo the requested trip and exact sample count
      // (captive portal, proxy) is not a receipt, and it is ambiguous: keep
      // the exact intent, spend an attempt, back off.
      await queue.noteReceiptMismatch(records.length);
      await retryLater(scope, records, 'receipt-mismatch', userId, { pin: { samples, key } });
      return false;
    }

    const code = body && typeof body.code === 'string' ? body.code : `http-${status}`;
    lastError = code;
    if (status === 401) {
      await release(code);
      await queue.clearStickyIntent(scope);
      pumpState = 'auth-blocked';
      return false;
    }
    if (status === 403) {
      // Ownership denial is about this trip only: skip it, keep the records
      // (they expire with the 24h window), let other trips upload.
      await release(code);
      return false;
    }
    if (status === 409 && code === 'location_stopped') {
      // The trip is closed and can never accept these samples: wipe the
      // scope and block late samples for it.
      await queue.noteTripStopped(records.length);
      await queue.wipeScope(scope);
      return false;
    }
    if (PERMANENT[code]) {
      await queue.failBatchPermanent(records, PERMANENT[code]);
      await queue.clearStickyIntent(scope);
      return true;
    }
    if (status === 400 && PER_SAMPLE[code]) {
      await queue.clearStickyIntent(scope); // a rejected request committed nothing
      if (records.length > 1) {
        // Isolate the offending sample instead of deleting the whole batch.
        await release(code);
        ctx.limit = Math.ceil(records.length / 2);
        return true;
      }
      const recent = queue.nowMs() - records[0].capturedAtMs < QUEUE_LIMITS.captureWindowMs / 2;
      if (code === 'capture_time_out_of_bounds' && recent) {
        // A recent capture the server sees as future-dated: the device clock
        // runs fast. It becomes acceptable as time passes; retry later.
        await retryLater(scope, records, code, userId);
        return false;
      }
      await queue.failBatchPermanent(records, PER_SAMPLE[code]);
      return true;
    }
    // 408, 429: not processed, retry without spending budget. 5xx: may have
    // been processed, keep the exact intent. Other 4xx (a route-not-found 404
    // from a misconfigured baseUrl, ...): retry with budget, delete nothing.
    const transient = status === 408 || status === 429;
    await retryLater(scope, records, code, userId, { countAttempt: !transient, pin: status >= 500 ? { samples, key } : null });
    return false;
  }

  async function uploadScope(scope, userId) {
    const ctx = { limit: batchSize, records: [] }; // limit halves while isolating a rejected sample
    for (let batches = 0; batches < maxBatchesPerFlush; batches += 1) {
      if (stopped || pumpState === 'auth-blocked') return;
      ctx.records = [];
      try {
        if (!(await uploadBatch(scope, userId, ctx))) return;
      } catch {
        // Client-side failure (store, missing crypto.subtle): never leave
        // the batch stuck 'uploading'.
        await queue.releaseBatch(ctx.records, 'client-error', { countAttempt: false }).catch(() => {});
        lastError = 'client-error';
        scheduleRetry(userId);
        return;
      }
    }
  }

  // Drains pending scopes plus any scopes holding an unacknowledged sticky
  // batch, for one owner only. Idempotent: a concurrent flush returns the
  // same in-flight promise. A flush with no owner (an `online` event before
  // any scoped flush) sends nothing.
  function flush({ userId } = {}) {
    if (stopped) return Promise.resolve({ ok: false, reason: 'stopped' });
    if (inFlight) return inFlight;
    if (typeof userId === 'string' && userId.length > 0) owner = userId;
    if (!owner) return Promise.resolve({ ok: false, reason: 'no-owner' });
    const subject = owner;
    inFlight = (async () => {
      pumpState = 'uploading';
      try {
        const scopes = new Map();
        for (const scope of [...await queue.pendingScopes(), ...await queue.stickyScopes()]) {
          if (scope.userId === subject) scopes.set(`${scope.userId} ${scope.tripId}`, { tripId: scope.tripId, userId: scope.userId });
        }
        for (const scope of scopes.values()) {
          await uploadScope(scope, subject);
          if (stopped || pumpState === 'auth-blocked') break;
        }
        if (pumpState === 'uploading') pumpState = 'idle';
        return { ok: true };
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  if (onlineTarget && typeof onlineTarget.addEventListener === 'function') {
    onlineTarget.addEventListener('online', () => {
      if (!stopped) flush().catch(() => {});
    });
  }

  // Permanent: aborts the request on the wire and cancels retries.
  function stop() {
    stopped = true;
    pumpState = 'stopped';
    if (retryTimer !== null) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
    request?.abort();
  }

  async function state() {
    return {
      pumpState,
      consecutiveFailures,
      lastError,
      lastReceipt,
      unacknowledgedBatches: (await queue.stickyScopes()).length,
      counts: await queue.counts(),
    };
  }

  return { flush, stop, state };
}
