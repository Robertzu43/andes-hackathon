import { createPhoneObservationAdapter } from './adapter.mjs';

// The application selects a reviewed context packet; this helper cannot qualify
// a phone. Consent belongs to this trip and is never inferred from permission.
export function createTripPhoneObservations({
  trip, reviewedContext = null, locationConsent = null, ...options
} = {}) {
  if (!trip || !['tripId', 'sessionId', 'revision'].every((key) =>
    typeof trip[key] === 'string' && trip[key].length > 0 && trip[key].length <= 160)) {
    throw new TypeError('A bounded tripId, sessionId and revision are required');
  }
  const context = { ...trip };
  let consent = locationConsent?.granted === true && locationConsent.tripId === trip.tripId &&
    typeof locationConsent.reference === 'string' && locationConsent.reference.length > 0 &&
    locationConsent.reference.length <= 160 ? {
      granted: true, purpose: 'active-trip-location-sharing', reference: locationConsent.reference,
    } : null;
  const adapter = createPhoneObservationAdapter({ ...options,
    contextKey: reviewedContext?.key ?? null,
    qualification: reviewedContext?.qualification ?? null,
    ...(reviewedContext?.budget ? { budget: reviewedContext.budget } : {}),
  });
  const gesture = (event, action) => event ? adapter.withUserGesture(event, action) : action();
  return {
    startSharing(event) {
      if (!consent) return { ok: false, reason: 'trip-location-consent-required' };
      if (adapter.snapshot().state === 'started') return { ok: false, reason: 'already-acquiring' };
      return gesture(event, () => {
        adapter.start(context);
        const location = adapter.acquireLocation({ watch: true, preciseConsent: consent });
        if (!location.ok) { adapter.stop(); return location; }
        return { ...location, wakeLock: adapter.requestWakeLock() };
      });
    },
    resumeSharing: (event) => gesture(event, () => adapter.resume()),
    stopSharing: () => adapter.stop(),
    revokeConsent: () => { consent = null; adapter.revokeConsent(); },
    snapshot: () => adapter.snapshot(),
  };
}

// Compose with the host's existing observation pipeline. That pipeline owns
// persistence, strict sample mapping, authentication, retries and HTTP receipts.
// This controller starts GPS only; opt-in motion evidence stays outside the trip.
export function createQueuedTripPhoneObservations({ pipeline, trip, ...options } = {}) {
  for (const method of ['sink', 'drain', 'flush', 'revokeTrip', 'tripStatus']) {
    if (typeof pipeline?.[method] !== 'function') throw new TypeError(`pipeline.${method} is required`);
  }
  const capture = createTripPhoneObservations({ ...options, trip,
    sink: (event) => pipeline.sink(event) });
  const tripId = trip.tripId;
  let withdrawn = false;
  let withdrawal = 'not-requested';
  let deleting = null;
  const blocked = () => ({ ok: false, reason: 'trip-location-consent-required' });

  function revokeConsent() {
    withdrawn = true;
    capture.revokeConsent(); // Invalidate capture and purge memory before any async queue work.
    if (deleting) return deleting;
    if (withdrawal === 'complete') return Promise.resolve({ ok: true });
    withdrawal = 'pending';
    deleting = Promise.resolve().then(() => pipeline.revokeTrip(tripId)).then((result) => {
      if (result?.ok === false) { withdrawal = 'failed'; return { ok: false, reason: 'queue-revocation-failed' }; }
      withdrawal = 'complete'; return { ok: true };
    }, () => {
      withdrawal = 'failed'; return { ok: false, reason: 'queue-revocation-failed' };
    }).finally(() => { deleting = null; });
    return deleting;
  }

  return {
    startSharing: (event) => withdrawn ? blocked() : capture.startSharing(event),
    resumeSharing: (event) => withdrawn ? Promise.resolve(blocked()) : capture.resumeSharing(event),
    stopSharing: () => capture.stopSharing(),
    revokeConsent,
    snapshot: () => ({ ...capture.snapshot(), queueWithdrawal: withdrawal }),
    drain: () => pipeline.drain(),
    flush: () => withdrawn ? Promise.resolve(blocked()) : pipeline.flush(),
    async status() {
      try {
        const queue = await pipeline.tripStatus(tripId);
        return { ok: true, capture: capture.snapshot(), queueWithdrawal: withdrawal, queue };
      } catch {
        return { ok: false, reason: 'queue-status-unavailable',
          capture: capture.snapshot(), queueWithdrawal: withdrawal };
      }
    },
  };
}
