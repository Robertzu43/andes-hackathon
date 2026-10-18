// Bounded durable observation queue.
//
// Stores mapped, upload-ready location samples (see upload.mjs for the wire
// contract) keyed by trip + owner user, in an injected store (IndexedDB in
// the browser, an in-memory double in tests). Retention and drops are
// explicit and counted; nothing leaves the queue silently and nothing is
// uploaded from memory alone.
//
// Concurrency: every mutation runs under one Web Lock and re-reads storage
// inside it, so two tabs, or an uploader and a sign-out wipe in one tab,
// never interleave a read-modify-write. Storage is the only source of truth;
// nothing durable is cached in memory.

export const QUEUE_LIMITS = Object.freeze({
  capacity: 2000, // retained records across all scopes
  batchMax: 100, // server POST /v1/trips/:id/locations maxItems
  captureWindowMs: 86_400_000, // server rejects captures older than 24h
  futureSkewMs: 30_000, // server rejects captures >30s in the future
  sendMarginMs: 60_000, // never send a capture this close to the 24h edge
  futureMarginMs: 5_000, // hold captures this close to the +30s edge until they are safely inside it
  revokedScopeRetention: 256, // bounded revoked-scope memory
});

const INITIAL_COUNTS = Object.freeze({
  enqueued: 0,
  uploaded: 0,
  droppedOverflow: 0,
  droppedDuplicate: 0,
  droppedOutOfBounds: 0, // expired or future-dated at enqueue, batch or retention sweep
  rejectedValidation: 0, // server 400 invalid_request on a single isolated sample
  rejectedBounds: 0, // server 400 capture_time_out_of_bounds on a single old sample
  rejectedMissing: 0, // server 404 trip_not_found
  tripStoppedRejections: 0, // server 409 location_stopped: trip closed, scope wiped
  conflictErrors: 0, // server 409 idempotency_conflict: client-side defect signal
  receiptMismatches: 0, // 2xx receipt that does not match the requested trip/count: defect, not confirmed
  wipedByRevocation: 0, // consent withdrawal / closed trip / explicit scope wipe
  wipedBySignout: 0, // owner sign-out: every record for the subject deleted
  failedRetained: 0, // attempts exhausted; retained for inspection until the 24h window expires
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
const intentId = (scope) => `intent:${scopeKey(scope)}`;

// Revocation tombstones are persisted as a one-way hash of the scope pair,
// never as owner/trip plaintext: the consent marker must survive restart,
// but a signed-out owner's identity must not sit in durable meta. FNV-1a
// 64-bit, synchronous, deterministic across sessions; reversing it requires
// already knowing both UUIDs, so the stored value reveals nothing.
function scopeHash(key) {
  let h = 0xcbf29ce484222325n;
  for (const char of key) {
    h ^= BigInt(char.codePointAt(0));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}

// One origin-wide lock: Web Locks serialise across tabs.
// ponytail: without navigator.locks (pre-2022 browsers) this only serialises
// one tab; cross-tab writers then race as they did before the lock.
let fallbackTail = Promise.resolve();
function withLock(fn) {
  const locks = globalThis.navigator?.locks;
  if (typeof locks?.request === 'function') return locks.request('andes-observation-queue', fn);
  const run = fallbackTail.then(fn);
  fallbackTail = run.catch(() => {});
  return run;
}

// Opens the queue on injected stores. Any record left in 'uploading' by an
// interrupted page is reset to 'pending' once at open.
export async function openObservationQueue({ records, meta, clock = { nowMs: () => Date.now() }, capacity = QUEUE_LIMITS.capacity }) {
  if (!records || !meta || typeof clock?.nowMs !== 'function') {
    throw new TypeError('records store, meta store and clock are required');
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100_000) {
    throw new RangeError('capacity must be a bounded positive integer');
  }

  // In-memory revocations: session-only sign-out scopes (deliberately never
  // persisted, so sign-out leaves no owner/trip plaintext) and scopes whose
  // wipe was requested but may not have reached storage yet.
  const revokedHere = new Set();
  // Last persisted tombstones seen by this tab, so isScopeRevoked() can stay
  // synchronous for the uploader's final pre-fetch gate.
  let revokedSeen = [];
  const isRevoked = (scope) => revokedHere.has(scopeKey(scope)) || revokedSeen.includes(scopeHash(scopeKey(scope)));

  async function loadState() {
    const state = (await meta.get('meta')) ?? { id: 'meta', seq: 0, counts: {}, revokedScopes: [] };
    // Counters added in later revisions default to 0 for existing databases.
    state.counts = { ...INITIAL_COUNTS, ...state.counts };
    // Legacy plaintext tombstones (pre-hash revisions) migrate on read.
    state.revokedScopes = (state.revokedScopes ?? []).map((entry) => (typeof entry === 'string' && entry.includes('→') ? scopeHash(entry) : entry));
    revokedSeen = state.revokedScopes;
    return state;
  }

  // Runs fn(state) under the lock on freshly read meta, then writes meta back.
  const locked = (fn) => withLock(async () => {
    const state = await loadState();
    const result = await fn(state);
    await meta.put('meta', state);
    return result;
  });

  const nowMs = () => clock.nowMs();
  const expired = (capturedAtMs) => capturedAtMs < nowMs() - QUEUE_LIMITS.captureWindowMs;
  const inBounds = (capturedAtMs) => !expired(capturedAtMs) && capturedAtMs <= nowMs() + QUEUE_LIMITS.futureSkewMs;
  // Safe to send now: inside the server window with a margin on both edges.
  const sendable = (capturedAtMs) => capturedAtMs >= nowMs() - QUEUE_LIMITS.captureWindowMs + QUEUE_LIMITS.sendMarginMs
    && capturedAtMs <= nowMs() + QUEUE_LIMITS.futureSkewMs - QUEUE_LIMITS.futureMarginMs;

  // Retention sweep (any owner, any state): expired captures and records of
  // revoked scopes are deleted, along with any durable intent that still
  // holds their coordinates. Returns the surviving records.
  async function sweep(state) {
    const kept = [];
    for (const record of await records.getAll()) {
      if (expired(record.capturedAtMs) || isRevoked(record)) {
        await records.delete(record.queueId);
        if (expired(record.capturedAtMs)) state.counts.droppedOutOfBounds += 1;
      } else {
        kept.push(record);
      }
    }
    for (const entry of await meta.getAll()) {
      if (!entry?.intent) continue;
      const stale = isRevoked(entry.intent) || (entry.intent.body?.observations ?? []).some((s) => expired(Date.parse(s.capturedAt)));
      if (stale) await meta.delete(entry.id);
    }
    return kept;
  }

  await locked(async (state) => {
    // Legacy: intents briefly lived inside the meta document. Move them onto
    // their own records so the on-disk shape is uniform.
    if (state.stickyIntents && typeof state.stickyIntents === 'object') {
      for (const legacy of Object.values(state.stickyIntents)) {
        if (!legacy || typeof legacy !== 'object') continue;
        const scope = { userId: legacy.userId, tripId: legacy.tripId };
        await meta.put(intentId(scope), {
          id: intentId(scope),
          intent: { key: legacy.key, body: { observations: legacy.samples }, userId: legacy.userId, tripId: legacy.tripId, sessionId: legacy.sessionId ?? null },
          queueIds: [...(legacy.queueIds ?? [])],
        });
      }
      delete state.stickyIntents;
    }
    for (const record of await sweep(state)) {
      if (record.state !== 'uploading') continue;
      record.state = 'pending';
      await records.put(record.queueId, record);
      state.counts.recoveredAfterInterruption += 1;
    }
  });

  // scope: { tripId, userId }. sample: wire-shaped location sample.
  // provenance: { eventId, sessionId, requestId } kept for local audit only;
  // never sent to the server.
  async function enqueue({ sample, provenance = {}, scope }) {
    if (!text(scope?.tripId) || !text(scope?.userId)) return { ok: false, reason: 'bad-scope' };
    return locked(async (state) => {
      if (isRevoked(scope)) return { ok: false, reason: 'scope-revoked' };
      const invalid = validateSample(sample);
      if (invalid) return { ok: false, reason: `bad-sample:${invalid}` };
      const capturedAtMs = Date.parse(sample.capturedAt);
      if (!inBounds(capturedAtMs)) {
        state.counts.droppedOutOfBounds += 1;
        return { ok: false, reason: 'capture-out-of-bounds' };
      }
      const existing = await sweep(state);
      // The server preserves the first committed sample per capture timestamp;
      // queueing a second copy of the same capture would be dead weight.
      if (existing.some((r) => r.tripId === scope.tripId && r.capturedAtMs === capturedAtMs && r.state !== 'failed')) {
        state.counts.droppedDuplicate += 1;
        return { ok: false, reason: 'duplicate-capture' };
      }
      if (existing.length >= capacity) {
        // Failed records are never uploaded automatically, so they go first.
        const bySeq = (a, b) => a.seq - b.seq;
        const evictable = [
          ...existing.filter((r) => r.state === 'failed').sort(bySeq),
          ...existing.filter((r) => r.state === 'pending').sort(bySeq),
        ];
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
        enqueuedAtMs: nowMs(),
        attempts: 0,
        lastError: null,
      };
      await records.put(record.queueId, record);
      state.counts.enqueued += 1;
      return { ok: true, queueId: record.queueId };
    });
  }

  async function pendingScopes() {
    const seen = new Map();
    for (const record of await records.getAll()) {
      if (record.state !== 'pending') continue;
      const key = scopeKey(record);
      seen.set(key, { tripId: record.tripId, userId: record.userId, pending: (seen.get(key)?.pending ?? 0) + 1 });
    }
    return [...seen.values()];
  }

  // Oldest sendable pending records for one scope, marked 'uploading'.
  // Captures too close to the 24h edge are dropped and counted rather than
  // sent to a guaranteed 400; captures too close to the +30s edge are held
  // (still pending) until they are safely inside it. Revoked scopes yield
  // nothing.
  async function takeBatch({ tripId, userId, limit = QUEUE_LIMITS.batchMax }) {
    return locked(async (state) => {
      if (isRevoked({ tripId, userId })) return [];
      const scoped = (await records.getAll())
        .filter((r) => r.tripId === tripId && r.userId === userId && r.state === 'pending')
        .sort((a, b) => a.seq - b.seq);
      const batch = [];
      for (const record of scoped) {
        if (batch.length >= limit) break;
        if (record.capturedAtMs < nowMs() - QUEUE_LIMITS.captureWindowMs + QUEUE_LIMITS.sendMarginMs) {
          await records.delete(record.queueId);
          state.counts.droppedOutOfBounds += 1;
          continue;
        }
        if (!sendable(record.capturedAtMs)) continue;
        record.state = 'uploading';
        await records.put(record.queueId, record);
        batch.push(record);
      }
      return batch;
    });
  }

  async function confirmUploaded(batch) {
    return locked(async (state) => {
      for (const record of batch) await records.delete(record.queueId);
      state.counts.uploaded += batch.length;
    });
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

  // Applies change(record) to each record that still exists. A record wiped
  // in the meantime is never re-created.
  async function updateExisting(queueIds, change) {
    const updated = [];
    for (const queueId of queueIds) {
      const record = await records.get(queueId);
      if (!record) continue;
      change(record);
      await records.put(record.queueId, record);
      updated.push(record);
    }
    return updated;
  }
  const ids = (batch) => batch.map((record) => record.queueId);
  const reason = (errorCode) => (text(errorCode) ? errorCode : 'unknown');

  // Count an upload attempt without changing record state. Returns the
  // updated records so the caller can apply its own exhaustion policy.
  async function noteAttempt(queueIds, errorCode) {
    return locked(() => updateExisting(queueIds, (record) => {
      record.attempts += 1;
      record.lastError = reason(errorCode);
    }));
  }

  // Back to pending, optionally with an attempt counted.
  async function releaseBatch(batch, errorCode, { countAttempt = true } = {}) {
    await locked(() => updateExisting(ids(batch), (record) => {
      record.state = 'pending';
      if (countAttempt) record.attempts += 1;
      record.lastError = reason(errorCode);
    }));
  }

  // Attempts exhausted: retained in 'failed' for inspection, never uploaded
  // again automatically, deleted when the capture window expires.
  async function markFailed(batch, errorCode) {
    await locked(async (state) => {
      const failed = await updateExisting(ids(batch), (record) => {
        record.state = 'failed';
        record.lastError = reason(errorCode);
      });
      state.counts.failedRetained += failed.length;
    });
  }

  // Permanent server rejection: delete and count under the given key.
  async function failBatchPermanent(batch, countKey) {
    await locked(async (state) => {
      for (const record of batch) await records.delete(record.queueId);
      state.counts[countKey] += batch.length;
    });
  }

  // Consent withdrawal / closed trip: the scope is marked revoked at once (so
  // nothing in flight can re-enter), the tombstone is persisted before any
  // deletion, then every record and intent for the scope is deleted.
  async function wipeScope({ tripId, userId }) {
    const key = scopeKey({ tripId, userId });
    revokedHere.add(key);
    return locked(async (state) => {
      const hash = scopeHash(key);
      if (!state.revokedScopes.includes(hash)) {
        state.revokedScopes.push(hash);
        if (state.revokedScopes.length > QUEUE_LIMITS.revokedScopeRetention) state.revokedScopes.shift();
        await meta.put('meta', state);
      }
      const scoped = (await records.getAll()).filter((r) => r.tripId === tripId && r.userId === userId);
      for (const record of scoped) await records.delete(record.queueId);
      await meta.delete(intentId({ tripId, userId }));
      state.counts.wipedByRevocation += scoped.length;
      return scoped.length;
    });
  }

  // Owner sign-out: every retained record and intent for the subject is
  // deleted and their scopes are revoked for this session only — sign-out
  // must not leave the owner's subject/trip plaintext in durable meta.
  async function wipeUser(userId) {
    if (!text(userId)) return 0;
    return locked(async (state) => {
      const mine = (await records.getAll()).filter((r) => r.userId === userId);
      for (const record of mine) {
        revokedHere.add(scopeKey(record));
        await records.delete(record.queueId);
      }
      for (const entry of await meta.getAll()) {
        if (entry?.intent?.userId !== userId) continue;
        revokedHere.add(scopeKey(entry.intent));
        await meta.delete(entry.id);
      }
      state.counts.wipedBySignout += mine.length;
      return mine.length;
    });
  }

  // Durable ambiguous-upload intent. When a batch's outcome is unknown (the
  // server may already hold it), the exact request body + idempotency key
  // are persisted as their own meta record, so a page reload / crash cannot
  // lose the original intent and accidentally regrow or rekey the retry.
  // `intent` is exactly { key, body, userId, tripId, sessionId } — the full
  // replay contract; queueIds identify the local records the body came from.
  // Nothing is written for a revoked scope or once any of its records is
  // gone (a wipe already ran), so a late failure cannot resurrect them.
  async function setStickyIntent(scope, { key, samples, queueIds, sessionId = null }) {
    return locked(async () => {
      if (isRevoked(scope)) return false;
      if ((await getRecords(queueIds)).length !== queueIds.length) return false;
      await meta.put(intentId(scope), {
        id: intentId(scope),
        intent: { key, body: { observations: samples }, userId: scope.userId, tripId: scope.tripId, sessionId },
        queueIds: [...queueIds],
      });
      return true;
    });
  }
  async function stickyIntent(scope) {
    const entry = await meta.get(intentId(scope));
    return entry?.intent ? { intent: entry.intent, queueIds: entry.queueIds ?? [] } : null;
  }
  async function stickyScopes() {
    return (await meta.getAll()).filter((entry) => entry?.intent).map(({ intent }) => ({ tripId: intent.tripId, userId: intent.userId }));
  }
  async function clearStickyIntent(scope) {
    await locked(() => meta.delete(intentId(scope)));
  }

  async function counts() {
    const state = await loadState();
    const live = { pending: 0, uploading: 0, failed: 0 };
    for (const record of await records.getAll()) live[record.state] += 1;
    return { ...state.counts, ...live, retained: live.pending + live.uploading + live.failed };
  }

  // Per-trip exposure of what is still unsent. `unsent` is a queue-occupancy
  // fact — it says nothing about delivery, freshness or trip health.
  async function scopeCounts({ tripId, userId }) {
    const live = { pending: 0, uploading: 0, failed: 0 };
    for (const record of await records.getAll()) {
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
    noteTripStopped: (n) => locked((state) => { state.counts.tripStoppedRejections += n; }),
    noteReceiptMismatch: (n) => locked((state) => { state.counts.receiptMismatches += n; }),
    isScopeRevoked: (scope) => isRevoked(scope),
    nowMs,
  };
}
