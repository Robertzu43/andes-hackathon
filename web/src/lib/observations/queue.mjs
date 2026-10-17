// Bounded durable observation queue.
//
// Stores mapped, upload-ready location samples (see upload.mjs for the wire
// contract) keyed by trip + owner user, in an injected store (IndexedDB in
// the browser, an in-memory double in tests). Retention and drops are
// explicit and counted; nothing leaves the queue silently and nothing is
// uploaded from memory alone.

export const QUEUE_LIMITS = Object.freeze({
  capacity: 2000, // retained records across all scopes
  batchMax: 100, // server POST /v1/trips/:id/locations maxItems
  captureWindowMs: 86_400_000, // server rejects captures older than 24h
  futureSkewMs: 30_000, // server rejects captures >30s in the future
  revokedScopeRetention: 256, // bounded revoked-scope memory
});

const INITIAL_COUNTS = Object.freeze({
  enqueued: 0,
  uploaded: 0,
  droppedOverflow: 0,
  droppedDuplicate: 0,
  droppedOutOfBounds: 0, // expired or future-dated at enqueue or batch time
  rejectedValidation: 0, // server 400/422: permanent, not retried
  rejectedBounds: 0, // server 400 capture_time_out_of_bounds
  rejectedMissing: 0, // server 404: trip missing
  tripStoppedRejections: 0, // server 409 location_stopped; records stay pending (map may reactivate)
  conflictErrors: 0, // server 409 idempotency_conflict: client-side defect signal
  wipedByRevocation: 0, // consent withdrawal / explicit scope wipe
  failedRetained: 0, // attempts exhausted; retained for inspection
  recoveredAfterInterruption: 0, // 'uploading' records reset to pending on open
});

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160;

// Mirrors the server schema exactly: capturedAt ISO date-time, latitude
// -90..90, longitude -180..180, accuracy 0..100000. Returns null when valid,
// otherwise a bounded reason string.
export function validateSample(sample) {
  if (!sample || typeof sample !== 'object') return 'not-an-object';
  if (typeof sample.capturedAt !== 'string' || !Number.isFinite(Date.parse(sample.capturedAt))) return 'bad-captured-at';
  if (!Number.isFinite(sample.latitude) || sample.latitude < -90 || sample.latitude > 90) return 'bad-latitude';
  if (!Number.isFinite(sample.longitude) || sample.longitude < -180 || sample.longitude > 180) return 'bad-longitude';
  if (!Number.isFinite(sample.accuracy) || sample.accuracy < 0 || sample.accuracy > 100_000) return 'bad-accuracy';
  return null;
}

const scopeKey = (scope) => `${scope.userId} →${scope.tripId}`;

// Opens the queue on injected stores. Any record left in 'uploading' by an
// interrupted page is reset to 'pending' once at open: open happens before
// any uploader exists, so 'uploading' at this point can only be a leftover.
export async function openObservationQueue({ records, meta, clock = { nowMs: () => Date.now() }, capacity = QUEUE_LIMITS.capacity }) {
  if (!records || !meta || typeof clock?.nowMs !== 'function') {
    throw new TypeError('records store, meta store and clock are required');
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000) {
    throw new RangeError('capacity must be a bounded positive integer');
  }
  const stored = await meta.get('meta');
  const state = stored ?? { id: 'meta', seq: 0, counts: { ...INITIAL_COUNTS }, revokedScopes: [] };
  const persist = () => meta.put('meta', state);

  const interrupted = (await records.getAll()).filter((record) => record.state === 'uploading');
  for (const record of interrupted) {
    record.state = 'pending';
    await records.put(record.queueId, record);
  }
  if (interrupted.length > 0) {
    state.counts.recoveredAfterInterruption += interrupted.length;
    await persist();
  }

  async function allRecords() {
    return records.getAll();
  }

  function inBounds(capturedAtMs) {
    const now = clock.nowMs();
    return capturedAtMs >= now - QUEUE_LIMITS.captureWindowMs && capturedAtMs <= now + QUEUE_LIMITS.futureSkewMs;
  }

  // scope: { tripId, userId }. sample: wire-shaped location sample.
  // provenance: { eventId, sessionId, requestId } kept for local audit only;
  // never sent to the server.
  async function enqueue({ sample, provenance = {}, scope }) {
    if (!text(scope?.tripId) || !text(scope?.userId)) return { ok: false, reason: 'bad-scope' };
    if (state.revokedScopes.includes(scopeKey(scope))) return { ok: false, reason: 'scope-revoked' };
    const invalid = validateSample(sample);
    if (invalid) return { ok: false, reason: `bad-sample:${invalid}` };
    const capturedAtMs = Date.parse(sample.capturedAt);
    if (!inBounds(capturedAtMs)) {
      state.counts.droppedOutOfBounds += 1;
      await persist();
      return { ok: false, reason: 'capture-out-of-bounds' };
    }
    const existing = await allRecords();
    // The server preserves the first committed sample per capture timestamp;
    // queueing a second copy of the same capture would be dead weight.
    if (existing.some((r) => r.tripId === scope.tripId && r.capturedAtMs === capturedAtMs && r.state !== 'failed')) {
      state.counts.droppedDuplicate += 1;
      await persist();
      return { ok: false, reason: 'duplicate-capture' };
    }
    if (existing.length >= capacity) {
      const evictable = existing.filter((r) => r.state === 'pending').sort((a, b) => a.seq - b.seq);
      if (evictable.length === 0) return { ok: false, reason: 'capacity-exhausted' };
      await records.delete(evictable[0].queueId);
      state.counts.droppedOverflow += 1;
    }
    state.seq += 1;
    const record = {
      queueId: `q-${state.seq}`,
      seq: state.seq,
      state: 'pending',
      tripId: scope.tripId,
      userId: scope.userId,
      sample: { capturedAt: sample.capturedAt, latitude: sample.latitude, longitude: sample.longitude, accuracy: sample.accuracy },
      capturedAtMs,
      provenance: {
        eventId: text(provenance.eventId) ? provenance.eventId : null,
        sessionId: text(provenance.sessionId) ? provenance.sessionId : null,
        requestId: text(provenance.requestId) ? provenance.requestId : null,
      },
      enqueuedAtMs: clock.nowMs(),
      attempts: 0,
      lastError: null,
    };
    await records.put(record.queueId, record);
    state.counts.enqueued += 1;
    await persist();
    return { ok: true, queueId: record.queueId };
  }

  async function pendingScopes() {
    const seen = new Map();
    for (const record of await allRecords()) {
      if (record.state !== 'pending') continue;
      const key = scopeKey(record);
      seen.set(key, { tripId: record.tripId, userId: record.userId, pending: (seen.get(key)?.pending ?? 0) + 1 });
    }
    return [...seen.values()];
  }

  // Oldest pending records for one scope, marked 'uploading'. Records that
  // aged out of the server's capture window while queued are dropped and
  // counted here rather than sent to a guaranteed 400.
  async function takeBatch({ tripId, userId, limit = QUEUE_LIMITS.batchMax }) {
    const scoped = (await allRecords())
      .filter((r) => r.tripId === tripId && r.userId === userId && r.state === 'pending')
      .sort((a, b) => a.seq - b.seq);
    const batch = [];
    for (const record of scoped) {
      if (batch.length >= limit) break;
      if (!inBounds(record.capturedAtMs)) {
        await records.delete(record.queueId);
        state.counts.droppedOutOfBounds += 1;
        continue;
      }
      record.state = 'uploading';
      await records.put(record.queueId, record);
      batch.push(record);
    }
    if (batch.length > 0 || scoped.length > 0) await persist();
    return batch;
  }

  async function confirmUploaded(batch) {
    for (const record of batch) await records.delete(record.queueId);
    state.counts.uploaded += batch.length;
    await persist();
  }

  // Transient failure: back to pending with an attempt counted.
  // countAttempt is false for auth blocks (a host problem, not retry budget).
  async function releaseBatch(batch, errorCode, { countAttempt = true } = {}) {
    for (const record of batch) {
      const current = await records.get(record.queueId);
      if (!current) continue; // wiped while in flight
      current.state = 'pending';
      if (countAttempt) current.attempts += 1;
      current.lastError = text(errorCode) ? errorCode : 'unknown';
      await records.put(current.queueId, current);
    }
  }

  // Attempts exhausted: retained in 'failed' for inspection, never silently
  // dropped and never uploaded again automatically.
  async function markFailed(batch, errorCode) {
    for (const record of batch) {
      const current = await records.get(record.queueId);
      if (!current) continue;
      current.state = 'failed';
      current.lastError = text(errorCode) ? errorCode : 'unknown';
      await records.put(current.queueId, current);
    }
    state.counts.failedRetained += batch.length;
    await persist();
  }

  // Permanent server rejection: delete and count under the given key.
  async function failBatchPermanent(batch, countKey) {
    for (const record of batch) await records.delete(record.queueId);
    state.counts[countKey] += batch.length;
    await persist();
  }

  // Consent withdrawal / explicit stop: every retained record for the scope
  // is deleted and the scope is remembered as revoked so late sink events
  // cannot re-enter the queue. Deletion is the point; counts keep the audit.
  async function wipeScope({ tripId, userId }) {
    const scoped = (await allRecords()).filter((r) => r.tripId === tripId && r.userId === userId);
    for (const record of scoped) await records.delete(record.queueId);
    const key = scopeKey({ tripId, userId });
    if (!state.revokedScopes.includes(key)) {
      state.revokedScopes.push(key);
      if (state.revokedScopes.length > QUEUE_LIMITS.revokedScopeRetention) state.revokedScopes.shift();
    }
    state.counts.wipedByRevocation += scoped.length;
    await persist();
    return scoped.length;
  }

  async function counts() {
    const live = { pending: 0, uploading: 0, failed: 0 };
    for (const record of await allRecords()) live[record.state] += 1;
    return { ...state.counts, ...live, retained: live.pending + live.uploading + live.failed };
  }

  return {
    enqueue, pendingScopes, takeBatch, confirmUploaded, releaseBatch,
    markFailed, failBatchPermanent, wipeScope, counts,
    noteTripStopped: async (n) => { state.counts.tripStoppedRejections += n; await persist(); },
    isScopeRevoked: (scope) => state.revokedScopes.includes(scopeKey(scope)),
  };
}
