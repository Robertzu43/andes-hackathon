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
// Upload acceptance is a server receipt fact, validated against the request
// (trip id + sample count) before anything is deleted locally. It is never a
// freshness, liveness or trip-health signal, and this module never fabricates
// one. Once a request may have reached the server (network failure or 5xx),
// the SAME batch content retries under the SAME idempotency key until
// acknowledged — it is never silently regrouped into a different request.

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
  let lastReceipt = null; // { tripId, received } — a validated receipt fact, nothing more
  let retryTimer = null;
  let lastUserId = null;

  // Sticky retry intent per scope: once a request's outcome is ambiguous
  // (network failure / 5xx), the identical content retries under the
  // identical key until acknowledged. Records stay 'uploading' between
  // flushes; a page restart recovers them to pending and the server's
  // first-commit-wins rule per capture timestamp is the durable guard.
  const sticky = new Map(); // skey -> { queueIds, samples, key }
  const skeyOf = (scope) => `${scope.userId} ${scope.tripId}`;

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

  // Ambiguous outcome (network error or 5xx): count attempts, retain the
  // sticky intent for the survivors, and fail out records that exhausted
  // their budget. If any record exhausted, the batch composition can no
  // longer be preserved — the sticky key is discarded and the survivors
  // regroup under a new key next flush; the server's per-capture-timestamp
  // dedupe keeps that safe.
  async function noteAmbiguousFailure(skey, records, samples, key, errorCode, userId) {
    const updated = await queue.noteAttempt(records.map((r) => r.queueId), errorCode);
    const exhausted = updated.filter((record) => record.attempts >= maxAttempts);
    if (exhausted.length > 0) {
      await queue.markFailed(exhausted, errorCode);
      const survivors = updated.filter((record) => record.attempts < maxAttempts);
      await queue.releaseBatch(survivors, errorCode, { countAttempt: false });
      sticky.delete(skey);
    } else {
      sticky.set(skey, { tripId: records[0].tripId, userId: records[0].userId, queueIds: records.map((r) => r.queueId), samples, key });
    }
    consecutiveFailures += 1;
    scheduleRetry(userId);
  }

  async function uploadScope(scope, userId) {
    const scopeOutcome = { batches: 0, skipped: false };
    const skey = skeyOf(scope);
    for (;;) {
      if (stopped || pumpState === 'auth-blocked' || scopeOutcome.batches >= maxBatchesPerFlush) return scopeOutcome;

      let records;
      let samples;
      let key;
      const stuck = sticky.get(skey);
      if (stuck) {
        records = await queue.getRecords(stuck.queueIds);
        if (records.length !== stuck.queueIds.length) {
          // Wiped (revocation / sign-out) while unacknowledged: never send
          // partial content under the old key. The intent is discarded;
          // takeBatch will find nothing for the wiped scope.
          sticky.delete(skey);
          continue;
        }
        ({ samples, key } = stuck);
      } else {
        records = await queue.takeBatch({ ...scope, limit: batchSize });
        if (records.length === 0) return scopeOutcome;
        samples = records.map((record) => record.sample);
        key = await idempotencyKey(scope.tripId, samples);
      }
      scopeOutcome.batches += 1;

      let token;
      try {
        token = await getAccessToken();
      } catch {
        token = null;
      }
      // Retirement gate: the token may resolve after stop()/revokeTrip() ran
      // while it was pending. A request that has not started yet MUST NOT
      // start for a retired pump or a wiped scope.
      if (stopped) {
        await queue.releaseBatch(records, 'stopped', { countAttempt: false });
        sticky.delete(skey);
        return scopeOutcome;
      }
      const present = await queue.getRecords(records.map((r) => r.queueId));
      if (present.length !== records.length) {
        sticky.delete(skey);
        continue;
      }
      if (typeof token !== 'string' || token.length === 0) {
        // No request was sent, so no intent is ambiguous; safe to regroup.
        await queue.releaseBatch(records, 'auth-unavailable', { countAttempt: false });
        sticky.delete(skey);
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
        lastError = 'network-error';
        await noteAmbiguousFailure(skey, records, samples, key, 'network-error', userId);
        return scopeOutcome;
      } finally {
        timers.clearTimeout(timeout);
      }

      if (response.status >= 200 && response.status < 300) {
        const body = await response.json().catch(() => null);
        if (body && body.id === scope.tripId && body.received === samples.length) {
          await queue.confirmUploaded(records);
          sticky.delete(skey);
          consecutiveFailures = 0;
          lastReceipt = { tripId: scope.tripId, received: body.received };
          continue;
        }
        // A 2xx that does not echo the requested trip and exact sample count
        // is not a receipt. Nothing is deleted; the defect is counted and the
        // pump halts for this scope instead of confirming a lie.
        await queue.noteReceiptMismatch(records.length);
        await queue.releaseBatch(records, 'receipt-mismatch', { countAttempt: false });
        sticky.delete(skey);
        lastError = 'receipt-mismatch';
        return scopeOutcome;
      }

      const code = await bodyCode(response);
      lastError = code;
      if (response.status === 401 || response.status === 403) {
        await queue.releaseBatch(records, code, { countAttempt: false });
        sticky.delete(skey);
        pumpState = 'auth-blocked';
        return scopeOutcome;
      }
      if (response.status === 409 && code === 'location_stopped') {
        // Map/trip inactive: server rejects new uploads, but a map can be
        // reactivated. Records stay pending without burning retry budget;
        // this scope is skipped for the rest of the flush.
        await queue.releaseBatch(records, code, { countAttempt: false });
        sticky.delete(skey);
        await queue.noteTripStopped(records.length);
        scopeOutcome.skipped = true;
        return scopeOutcome;
      }
      if (response.status === 404) {
        await queue.failBatchPermanent(records, 'rejectedMissing');
        sticky.delete(skey);
        continue;
      }
      if (response.status === 400 && code === 'capture_time_out_of_bounds') {
        await queue.failBatchPermanent(records, 'rejectedBounds');
        sticky.delete(skey);
        continue;
      }
      if (response.status === 409 && code === 'idempotency_conflict') {
        // Same key, different content: deterministic keys make this a client
        // defect signal, not a retryable condition.
        await queue.failBatchPermanent(records, 'conflictErrors');
        sticky.delete(skey);
        continue;
      }
      if (response.status >= 400 && response.status < 500) {
        await queue.failBatchPermanent(records, 'rejectedValidation');
        sticky.delete(skey);
        continue;
      }
      // 5xx or anything unexpected: ambiguous, retry the identical intent.
      await noteAmbiguousFailure(skey, records, samples, key, code, userId);
      return scopeOutcome;
    }
  }

  // Drains pending scopes plus any scopes holding an unacknowledged sticky
  // batch. Idempotent: a concurrent flush returns the same in-flight
  // promise. userId scopes the drain to the signed-in owner; a flush never
  // uploads another subject's records.
  function flush({ userId } = {}) {
    if (stopped) return Promise.resolve({ ok: false, reason: 'stopped' });
    if (inFlight) return inFlight;
    lastUserId = userId ?? lastUserId;
    inFlight = (async () => {
      pumpState = 'uploading';
      try {
        const scopes = await queue.pendingScopes();
        const byKey = new Map(scopes.map((scope) => [skeyOf(scope), scope]));
        for (const [stuckKey, stuck] of sticky) {
          if (!byKey.has(stuckKey)) byKey.set(stuckKey, { tripId: stuck.tripId, userId: stuck.userId });
        }
        for (const scope of byKey.values()) {
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
      unacknowledgedBatches: sticky.size,
      counts: await queue.counts(),
    };
  }

  return { flush, stop, state };
}
