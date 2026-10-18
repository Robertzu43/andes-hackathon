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
  receiptMismatches: 0, // 2xx receipt that does not match the requested trip/count: defect, not confirmed
  wipedByRevocation: 0, // consent withdrawal / explicit scope wipe
  wipedBySignout: 0, // owner sign-out: every record for the subject deleted
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
  // Counters added in later revisions default to 0 for existing databases.
  state.counts = { ...INITIAL_COUNTS, ...state.counts };
  state.revokedScopes ??= [];
  // Session-only revocations (owner sign-out): same re-entry protection as a
  // persisted revocation but deliberately NOT written to storage, so sign-out
  // leaves no owner/trip plaintext behind.
  const sessionRevoked = new Set();
  const persist = () => meta.put('meta', state);
  const isRevoked = (scope) => sessionRevoked.has(scopeKey(scope)) || state.revokedScopes.includes(scopeKey(scope));

  // Durable ambiguous-upload intents, one meta record per scope
  // (`intent:<userId> →<tripId>`). The `intent` field holds exactly the
  // replay contract — { key, body, userId, tripId, sessionId } — while the
  // owning queue ids sit alongside it. A page reload / crash re-reads these
  // records, so the original request is replayed byte-identical under the
  // original idempotency key instead of being regrown or rekeyed.
  const intents = new Map();
  const intentId = (scope) => `intent:${scopeKey(scope)}`;
  for (const entry of await meta.getAll()) {
    if (entry && typeof entry === 'object' && entry.intent && typeof entry.intent === 'object') {
      intents.set(scopeKey(entry.intent), { intent: entry.intent, queueIds: [...(entry.queueIds ?? [])] });
    }
  }
  // Legacy: intents briefly lived inside the meta document. Move them onto
  // their own records so the on-disk shape is uniform.
  if (state.stickyIntents && typeof state.stickyIntents === 'object') {
    for (const legacy of Object.values(state.stickyIntents)) {
      if (!legacy || typeof legacy !== 'object') continue;
      const scope = { userId: legacy.userId, tripId: legacy.tripId };
      const record = {
        id: intentId(scope),
        intent: {
          key: legacy.key,
          body: { observations: legacy.samples },
          userId: legacy.userId,
          tripId: legacy.tripId,
          sessionId: legacy.sessionId ?? null,
        },
        queueIds: [...(legacy.queueIds ?? [])],
      };
      intents.set(scopeKey(scope), { intent: record.intent, queueIds: record.queueIds });
      await meta.put(record.id, record);
    }
    delete state.stickyIntents;
    await persist();
  }

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
    if (isRevoked(scope)) return { ok: false, reason: 'scope-revoked' };
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
      // The capture session the scope was opened under; carried onto the
      // durable sticky intent so a replay after restart is attributable to
      // the session that produced the original request.
      sessionId: text(scope.sessionId) ? scope.sessionId : null,
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

  // Fetch current records by id. Missing records (wiped while in flight) are
  // simply absent from the result — callers treat absence as "do not send".
  async function getRecords(queueIds) {
    const found = [];
    for (const queueId of queueIds) {
      const record = await records.get(queueId);
      if (record) found.push(record);
    }
    return found;
  }

  // Count an upload attempt without changing record state. Returns the
  // updated records so the caller can apply its own exhaustion policy
  // (survivors are then released back to 'pending' by the caller; the
  // durable sticky intent — not record state — carries the retry contract).
  async function noteAttempt(queueIds, errorCode) {
    const updated = [];
    for (const queueId of queueIds) {
      const record = await records.get(queueId);
      if (!record) continue;
      record.attempts += 1;
      record.lastError = text(errorCode) ? errorCode : 'unknown';
      await records.put(record.queueId, record);
      updated.push(record);
    }
    return updated;
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
    intents.delete(key);
    await meta.delete(intentId({ tripId, userId }));
    state.counts.wipedByRevocation += scoped.length;
    await persist();
    return scoped.length;
  }

  // Owner sign-out: every retained record for the subject is deleted and all
  // of their scopes are revoked for this session, so nothing uploadable
  // survives and late events cannot re-enter. Unlike wipeScope, the
  // revocation is session-only: sign-out must not leave the owner's
  // subject/trip plaintext sitting in durable meta. Distinct from wipeScope
  // (one trip, persisted, consent state that must survive restart).
  async function wipeUser(userId) {
    if (!text(userId)) return 0;
    const mine = (await allRecords()).filter((r) => r.userId === userId);
    for (const record of mine) await records.delete(record.queueId);
    for (const [key, held] of intents) {
      if (held.intent.userId !== userId) continue;
      intents.delete(key);
      await meta.delete(`intent:${key}`);
    }
    for (const record of mine) sessionRevoked.add(scopeKey(record));
    state.counts.wipedBySignout += mine.length;
    await persist();
    return mine.length;
  }

  // Durable ambiguous-upload intent. When a batch's outcome is unknown (the
  // server may already hold it), the exact request body + idempotency key
  // are persisted as their own meta record, so a page reload / crash cannot
  // lose the original intent and accidentally regrow or rekey the retry.
  // `intent` is exactly { key, body, userId, tripId, sessionId } — the full
  // replay contract; queueIds identify the local records the body came from.
  async function setStickyIntent(scope, { key, samples, queueIds, sessionId = null }) {
    const record = {
      id: intentId(scope),
      intent: {
        key,
        body: { observations: samples },
        userId: scope.userId,
        tripId: scope.tripId,
        sessionId,
      },
      queueIds: [...queueIds],
    };
    intents.set(scopeKey(scope), { intent: record.intent, queueIds: record.queueIds });
    await meta.put(record.id, record);
  }
  const stickyIntent = (scope) => intents.get(scopeKey(scope)) ?? null;
  const stickyScopes = () => [...intents.values()].map(({ intent }) => ({ tripId: intent.tripId, userId: intent.userId }));
  async function clearStickyIntent(scope) {
    const key = scopeKey(scope);
    if (!intents.has(key)) return;
    intents.delete(key);
    await meta.delete(intentId(scope));
  }

  async function counts() {
    const live = { pending: 0, uploading: 0, failed: 0 };
    for (const record of await allRecords()) live[record.state] += 1;
    return { ...state.counts, ...live, retained: live.pending + live.uploading + live.failed };
  }

  // Per-trip exposure of what is still unsent. `unsent` is a queue-occupancy
  // fact — it says nothing about delivery, freshness or trip health.
  async function scopeCounts({ tripId, userId }) {
    const live = { pending: 0, uploading: 0, failed: 0 };
    for (const record of await allRecords()) {
      if (record.tripId === tripId && record.userId === userId) live[record.state] += 1;
    }
    return {
      ...live,
      unsent: live.pending + live.uploading + live.failed,
      revoked: isRevoked({ tripId, userId }),
    };
  }

  return {
    enqueue, pendingScopes, takeBatch, confirmUploaded, releaseBatch,
    markFailed, failBatchPermanent, wipeScope, wipeUser, counts, scopeCounts,
    getRecords, noteAttempt,
    setStickyIntent, stickyIntent, stickyScopes, clearStickyIntent,
    noteTripStopped: async (n) => { state.counts.tripStoppedRejections += n; await persist(); },
    noteReceiptMismatch: async (n) => { state.counts.receiptMismatches += n; await persist(); },
    isScopeRevoked: (scope) => isRevoked(scope),
  };
}
