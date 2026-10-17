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
