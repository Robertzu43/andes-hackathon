// Pipeline: adapter sink -> durable queue -> upload bridge.
//
// The phone observation adapter (src/phone-observations/adapter.mjs, PR52)
// requires a SYNCHRONOUS local sink: a thenable or a throw is counted as a
// sink error. IndexedDB writes are async, so the sink maps and stages
// synchronously, then an immediately scheduled serialized drain persists to
// the queue. Events staged but not yet drained are lost if the page is
// killed in between; that window is documented, not hidden.
//
// Only adapter geolocation events that carry consented coordinates map to
// the backend's single accepted upload shape. Everything else — redacted
// geolocation, motion, permission and other events — has no server route in
// the current contract and is dropped AT THE BOUNDARY with an explicit
// count. session-start/session-stop are observed into a local per-trip
// intent map (see tripStatus) and are never staged or uploaded. Nothing is
// queued for an invented endpoint.

const PROVISIONAL_SCHEMA = 'andes.phone-observations.provisional/1';
// Deliberately duplicated from the adapter module: web/ must not import from
// the tools/src tree, and the schema string is the contract itself.

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160;

export function createObservationPipeline({ queue, uploader, ownerSubject, onError = null }) {
  if (!queue || !uploader) throw new TypeError('queue and uploader are required');
  if (!text(ownerSubject)) throw new TypeError('ownerSubject (signed-in owner OIDC sub) is required');

  const counters = {
    received: 0,
    staged: 0,
    persisted: 0,
    persistErrors: 0,
    stageOverflow: 0, // staged list full; event dropped before persistence
    unmappedSchema: 0, // not the provisional phone-observation schema
    unmappedNoRoute: 0, // valid observation with no server route (motion, permission, other)
    lifecycleObserved: 0, // session-start/session-stop: local intent, never uploaded
    droppedNoCoordinates: 0, // redacted geolocation: never leaves the device
    droppedMissingAccuracy: 0, // server requires accuracy; adapter reported it unknown
    droppedBadSourceTime: 0, // no unix-epoch source timestamp to preserve
    droppedBadSample: 0, // failed the wire-shape validation
    enqueueRejected: 0, // queue refused (duplicate, out of bounds, revoked, capacity)
  };
  const staging = [];
  const stagingCapacity = 512; // bounded staging between sink and drain
  let drainChain = Promise.resolve();
  let stopped = false;
  // Latest observed lifecycle intent per trip (page-lifetime, observability
  // only). A session-stop is local intent — never a delivery, freshness or
  // trip-closure claim, and nothing is POSTed for it (the /sharing endpoint
  // does not exist in the current backend contract).
  const lifecycle = new Map();

  async function drainStaged() {
    while (staging.length > 0) {
      const item = staging.shift();
      try {
        const result = await queue.enqueue({
          sample: item.sample,
          provenance: item.provenance,
          scope: { tripId: item.tripId, userId: ownerSubject },
        });
        if (result.ok) counters.persisted += 1;
        else counters.enqueueRejected += 1;
      } catch (error) {
        counters.persistErrors += 1;
        if (typeof onError === 'function') onError(error);
      }
    }
  }

  function scheduleDrain() {
    drainChain = drainChain.then(drainStaged);
  }

  // Adapter sink. Synchronous, never throws, never returns a thenable.
  function sink(event) {
    counters.received += 1;
    if (stopped || !event || event.schema !== PROVISIONAL_SCHEMA) {
      counters.unmappedSchema += 1;
      return;
    }
    if (event.type === 'session-start' || event.type === 'session-stop') {
      counters.lifecycleObserved += 1;
      if (text(event.tripId)) {
        const data = event.data ?? {};
        lifecycle.set(event.tripId, {
          intent: event.type === 'session-start' ? 'active' : 'stopped',
          reason: text(data.reason) ? data.reason : null,
          sharingState: text(data.sharingState) ? data.sharingState : null,
          resumable: data.resumable === true,
          eventId: text(event.eventId) ? event.eventId : null,
        });
      }
      return;
    }
    if (event.type !== 'geolocation') {
      counters.unmappedNoRoute += 1;
      return;
    }
    const data = event.data ?? {};
    const sourceTime = event.sourceTime;
    if (sourceTime?.basis !== 'unix-epoch-ms' || !Number.isFinite(sourceTime.value)) {
      counters.droppedBadSourceTime += 1;
      return;
    }
    const coordinates = data.coordinates;
    if (!coordinates) {
      // Precise position is redacted unless request-specific consent was
      // given at acquisition. A redacted event is honored, not uploaded.
      counters.droppedNoCoordinates += 1;
      return;
    }
    if (!Number.isFinite(data.accuracyM)) {
      counters.droppedMissingAccuracy += 1;
      return;
    }
    // Source capture time is preserved end to end; client receipt time is
    // never substituted for it.
    const sample = {
      capturedAt: new Date(sourceTime.value).toISOString(),
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      accuracy: data.accuracyM,
    };
    if (staging.length >= stagingCapacity) {
      counters.stageOverflow += 1;
      return;
    }
    staging.push({
      sample,
      tripId: event.tripId,
      provenance: { eventId: event.eventId ?? null, sessionId: event.sessionId ?? null, requestId: data.requestId ?? null },
    });
    counters.staged += 1;
    scheduleDrain();
  }

  // Resolves when everything staged so far has been offered to the queue.
  // Hosts should await this before pagehide if they want the staging window
  // closed; it is a best-effort handoff, not a durability guarantee.
  function drain() {
    return drainChain;
  }

  async function flush() {
    await drain();
    return uploader.flush({ userId: ownerSubject });
  }

  // Consent withdrawn for a trip: wipe its queued records and block re-entry.
  // The host must also call the adapter's own revokeConsent to stop capture.
  async function revokeTrip(tripId) {
    await drain();
    return queue.wipeScope({ tripId, userId: ownerSubject });
  }

  async function stop() {
    stopped = true;
    await drain().catch(() => {});
    uploader.stop();
  }

  // Owner sign-out: stop the pump, then delete every queued record for the
  // subject and revoke all of their scopes. Nothing uploadable and no
  // lifecycle residue survives the session. Returns the wiped record count.
  async function signOut() {
    stopped = true;
    await drain().catch(() => {});
    uploader.stop();
    lifecycle.clear();
    return queue.wipeUser(ownerSubject);
  }

  async function counts() {
    return { boundary: { ...counters }, queue: await queue.counts(), lifecycle: Object.fromEntries(lifecycle) };
  }

  // Per-trip status: latest observed lifecycle intent plus the durable
  // unsent counts. `unsent` is queue occupancy, not a delivery statement.
  async function tripStatus(tripId) {
    return {
      lifecycle: lifecycle.get(tripId) ?? null,
      queue: await queue.scopeCounts({ tripId, userId: ownerSubject }),
    };
  }

  return { sink, drain, flush, revokeTrip, stop, signOut, counts, tripStatus };
}
