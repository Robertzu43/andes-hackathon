// Upload bridge: drains the durable queue onto
// POST /v1/trips/:id/locations from the backend runtime contract.
//
// Contract facts this module is written against (docs/contracts/runtime.md,
// branch codex/aws-durable-backend):
//   - owner-only Bearer OIDC auth; every POST requires Idempotency-Key
//     (1-128 visible ASCII, scoped actor/method/route/params; same key +
//     same content replays the persisted response, changed content -> 409)
//   - body { observations: [{ capturedAt ISO date-time, latitude, longitude,
//     accuracy }] }, 1..100 items
//   - 400 capture_time_out_of_bounds (>24h old or >30s future), 404 trip
//     missing, 409 location_stopped (map inactive / trip not active),
//     409 idempotency_conflict, 401/403 auth/ownership
//   - success: { id, received }
//
// Upload acceptance is a server receipt fact. It is never a freshness,
// liveness or trip-health signal, and this module never fabricates one.

import { QUEUE_LIMITS } from './queue.mjs';

const DEFAULTS = Object.freeze({
  batchSize: QUEUE_LIMITS.batchMax,
  maxAttempts: 8,
  baseBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  requestTimeoutMs: 15_000,
  maxBatchesPerFlush: 10,
});

async function sha256Hex(text) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const bodyCode = async (response) => {
  const body = await response.json().catch(() => null);
  return body && typeof body.code === 'string' ? body.code : `http-${response.status}`;
};

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

  let inFlight = null;
  let stopped = false;
  let pumpState = 'idle'; // idle | uploading | auth-blocked | stopped
  let consecutiveFailures = 0;
  let lastError = null;
  let lastReceipt = null; // { tripId, received } — a receipt fact, nothing more
  let retryTimer = null;
  let lastUserId = null;

  // Same batch content -> same key, so a reconnect retry replays the server's
  // persisted response instead of double-inserting. 74 visible ASCII chars.
  async function idempotencyKey(tripId, samples) {
    const canonical = JSON.stringify({ v: 1, route: 'locations', tripId, samples });
    return `loc1-${await digest(canonical)}`;
  }

  function scheduleRetry(userId) {
    if (retryTimer !== null || stopped) return;
    const backoffMs = Math.min(maxBackoffMs, baseBackoffMs * 2 ** Math.max(0, consecutiveFailures - 1));
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (!stopped) flush({ userId }).catch(() => {});
    }, backoffMs);
  }

  async function uploadScope(scope, userId) {
    const scopeOutcome = { batches: 0, skipped: false };
    for (;;) {
      if (stopped || pumpState === 'auth-blocked' || scopeOutcome.batches >= maxBatchesPerFlush) return scopeOutcome;
      const batch = await queue.takeBatch({ ...scope, limit: batchSize });
      if (batch.length === 0) return scopeOutcome;
      scopeOutcome.batches += 1;
      const samples = batch.map((record) => record.sample);
      const key = await idempotencyKey(scope.tripId, samples);

      let token;
      try {
        token = await getAccessToken();
      } catch {
        token = null;
      }
      if (typeof token !== 'string' || token.length === 0) {
        await queue.releaseBatch(batch, 'auth-unavailable', { countAttempt: false });
        pumpState = 'auth-blocked';
        lastError = 'auth-unavailable';
        return scopeOutcome;
      }

      const controller = new AbortController();
      const timeout = timers.setTimeout(() => controller.abort(), requestTimeoutMs);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/trips/${encodeURIComponent(scope.tripId)}/locations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': key,
          },
          body: JSON.stringify({ observations: samples }),
          signal: controller.signal,
        });
      } catch {
        await queue.releaseBatch(batch, 'network-error');
        lastError = 'network-error';
        consecutiveFailures += 1;
        scheduleRetry(userId);
        return scopeOutcome;
      } finally {
        timers.clearTimeout(timeout);
      }

      if (response.status >= 200 && response.status < 300) {
        const body = await response.json().catch(() => null);
        await queue.confirmUploaded(batch);
        consecutiveFailures = 0;
        lastReceipt = { tripId: scope.tripId, received: Number.isSafeInteger(body?.received) ? body.received : null };
        continue;
      }

      const code = await bodyCode(response);
      lastError = code;
      if (response.status === 401 || response.status === 403) {
        await queue.releaseBatch(batch, code, { countAttempt: false });
        pumpState = 'auth-blocked';
        return scopeOutcome;
      }
      if (response.status === 409 && code === 'location_stopped') {
        // Map/trip inactive: server rejects new uploads, but a map can be
        // reactivated. Records stay pending without burning retry budget;
        // this scope is skipped for the rest of the flush.
        await queue.releaseBatch(batch, code, { countAttempt: false });
        await queue.noteTripStopped(batch.length);
        scopeOutcome.skipped = true;
        return scopeOutcome;
      }
      if (response.status === 404) {
        await queue.failBatchPermanent(batch, 'rejectedMissing');
        continue;
      }
      if (response.status === 400 && code === 'capture_time_out_of_bounds') {
        await queue.failBatchPermanent(batch, 'rejectedBounds');
        continue;
      }
      if (response.status === 409 && code === 'idempotency_conflict') {
        // Same key, different content: deterministic keys make this a client
        // defect signal, not a retryable condition.
        await queue.failBatchPermanent(batch, 'conflictErrors');
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
        await queue.failBatchPermanent(batch, 'rejectedValidation');
        continue;
      }
      // 5xx or anything unexpected: transient.
      const exhausted = batch.filter((record) => record.attempts + 1 >= maxAttempts);
      const retryable = batch.filter((record) => record.attempts + 1 < maxAttempts);
      if (retryable.length > 0) await queue.releaseBatch(retryable, code);
      if (exhausted.length > 0) await queue.markFailed(exhausted, code);
      consecutiveFailures += 1;
      scheduleRetry(userId);
      return scopeOutcome;
    }
  }

  // Drains pending scopes. Idempotent: a concurrent flush returns the same
  // in-flight promise. userId scopes the drain to the signed-in owner; a
  // flush never uploads another subject's records.
  function flush({ userId } = {}) {
    if (stopped) return Promise.resolve({ ok: false, reason: 'stopped' });
    if (inFlight) return inFlight;
    lastUserId = userId ?? lastUserId;
    inFlight = (async () => {
      pumpState = 'uploading';
      try {
        const scopes = await queue.pendingScopes();
        for (const scope of scopes) {
          if (lastUserId && scope.userId !== lastUserId) continue;
          await uploadScope(scope, lastUserId);
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

  function stop() {
    stopped = true;
    pumpState = 'stopped';
    if (retryTimer !== null) {
      timers.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  async function state() {
    return {
      pumpState,
      consecutiveFailures,
      lastError,
      lastReceipt,
      counts: await queue.counts(),
    };
  }

  return { flush, stop, state };
}
