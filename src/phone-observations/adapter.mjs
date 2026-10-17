// Local observation tooling for #19. No transport, detection or device qualification.
export const EVENT_SCHEMA = 'andes.phone-observations.provisional/1';
export const QUALIFICATION_SCHEMA = 'andes.phone-observations.qualification/1';

// Engineering guardrails only; #9/#11 have not accepted a capability/resource budget.
export const PROVISIONAL_BUDGET = Object.freeze({
  revision: 'engineering-only/1', bufferCapacity: 128, maxEvents: 256,
  maxCallbacksPerStream: 1024, maxRequests: 8, maxSessionMs: 300_000,
  minEmitIntervalMs: 1000, requestTimeoutMs: 10_000, maximumAgeMs: 0,
  freshnessMs: null, clockToleranceMs: 100,
});

const copy = (value) => JSON.parse(JSON.stringify(value));
const finite = (value) => Number.isFinite(value) ? value : null;
const nonnegative = (value) => Number.isFinite(value) && value >= 0 ? value : null;
const read = (fn, fallback = null) => { try { return fn() ?? fallback; } catch { return fallback; } };
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 160;
const listenable = (target) => typeof target?.addEventListener === 'function' &&
  typeof target?.removeEventListener === 'function';
const permissionState = (value) => ['granted', 'denied', 'prompt'].includes(value) ? value : 'unknown';

export function createPhoneObservationAdapter({
  platform = globalThis,
  clock = { now: () => ({ wallMs: Date.now(), monoMs: globalThis.performance?.now() }) },
  sink = () => {}, mode = 'device', contextKey = null, qualification = null,
  budget = PROVISIONAL_BUDGET,
} = {}) {
  if (!['device', 'synthetic-test'].includes(mode)) throw new TypeError('Invalid mode');
  if (mode === 'synthetic-test' && platform === globalThis) {
    throw new TypeError('Synthetic mode requires an injected platform');
  }
  if (typeof clock?.now !== 'function' || typeof sink !== 'function' ||
      typeof platform.setTimeout !== 'function' || typeof platform.clearTimeout !== 'function') {
    throw new TypeError('A clock, synchronous local sink and timer platform are required');
  }
  const limits = validateBudget(budget);
  const reviewed = qualification === null ? null : copy(qualification);
  let current = null;
  let generation = 0;
  let sequence = 0;
  let delivering = false;

  const visibility = () => read(() => platform.document.visibilityState, 'unknown');
  const live = (s) => current === s && s.active;
  const stamp = () => {
    const at = read(() => clock.now(), {});
    return { wallMs: finite(at.wallMs), monoMs: nonnegative(at.monoMs) };
  };

  function atSession(s) {
    const at = stamp();
    const { wallMs, monoMs } = s.started;
    if (at.wallMs === null || at.monoMs === null || wallMs === null || monoMs === null ||
        at.monoMs < s.lastMono || Math.abs((at.wallMs - wallMs) - (at.monoMs - monoMs)) > limits.clockToleranceMs) {
      s.clockUncertain = true;
    }
    if (at.monoMs !== null) s.lastMono = at.monoMs;
    return at;
  }

  function emit(s, type, data = {}, sourceTime = null, at = atSession(s)) {
    if (!live(s) || s.emitted >= limits.maxEvents) return;
    sequence += 1;
    s.emitted += 1;
    const event = {
      schema: EVENT_SCHEMA, category: 'phone-observation', type,
      eventId: `${s.context.sessionId}:${s.generation}:${sequence}`,
      ...s.context, sequence, sessionSequence: s.emitted,
      sourceTime, clientReceiptTime: at, serverReceiptTime: null,
      revision: s.context.revision, policyVersion: null,
      budgetRevision: limits.revision, visibility: visibility(),
      permission: copy(s.permission),
      provenance: {
        mode, qualificationEvidence: text(reviewed?.evidenceRef) ? reviewed.evidenceRef : null,
        contextKey: text(contextKey) ? contextKey : null,
        boundary: 'provisional-client-only', clock: 'device-unreconciled',
        clockUncertain: s.clockUncertain, serverLatency: 'unknown',
      },
      interpretation: 'observation-only', data,
    };
    if (s.events.length === limits.bufferCapacity) { s.events.shift(); s.dropped += 1; }
    s.events.push(copy(event));
    // No async queue or retries. Sink failures are diagnostic counts, never delivery evidence.
    delivering = true;
    try {
      const result = sink(copy(event));
      if (result && typeof result.then === 'function') {
        s.sinkErrors += 1;
        Promise.resolve(result).catch(() => {});
      }
    } catch { s.sinkErrors += 1; }
    finally { delivering = false; }
    if (live(s) && s.emitted >= limits.maxEvents) finish(s, 'event-budget');
  }

  function subscribe(s, target, name, handler) {
    if (!listenable(target)) return false;
    target.addEventListener(name, handler);
    s.cleanups.push(() => target.removeEventListener(name, handler));
    return true;
  }

  function cancel(s, stream) {
    const token = s[stream];
    if (!token) return;
    s[stream] = null; // Invalidate first: clearWatch/removeEventListener can race queued callbacks.
    token.active = false;
    if (token.timer !== null) read(() => platform.clearTimeout(token.timer));
    if (stream === 'geo' && token.watchId !== null) {
      if (!read(() => { token.api.clearWatch(token.watchId); return true; }, false)) s.cleanupErrors += 1;
    }
    if (stream === 'motion' && token.handler) {
      if (!read(() => { platform.removeEventListener('devicemotion', token.handler); return true; }, false)) s.cleanupErrors += 1;
    }
  }

  function finish(s, reason) {
    if (!live(s)) return;
    s.active = false;
    s.stopReason = reason;
    cancel(s, 'geo');
    cancel(s, 'motion');
    read(() => platform.clearTimeout(s.timer));
    for (const cleanup of s.cleanups.splice(0)) {
      if (!read(() => { cleanup(); return true; }, false)) s.cleanupErrors += 1;
    }
  }

  function updatePermission(s, stream, browserState, source, requestId = null) {
    if (!live(s)) return;
    const old = s.permission[stream];
    const state = old.state === 'granted' && browserState !== 'granted' ? 'revoked' : browserState;
    s.permission[stream] = { state, browserState, source };
    if (state !== 'granted') cancel(s, stream === 'geolocation' ? 'geo' : 'motion');
    emit(s, 'permission', { stream, state, browserState, source, requestId });
  }

  function observePermission(s, name, stream) {
    if (s.permissionQueries.has(name)) return;
    s.permissionQueries.add(name);
    const permissions = read(() => platform.navigator.permissions);
    if (typeof permissions?.query !== 'function') return;
    let pending;
    try { pending = permissions.query({ name }); }
    catch { return; }
    Promise.resolve(pending).then((status) => {
      if (!live(s)) return;
      const update = () => {
        const state = permissionState(status?.state);
        // A single sensor's grant cannot restore a revoked two-sensor motion grant.
        if (stream === 'motion' && state === 'granted') {
          emit(s, 'permission-observed', { stream, sensor: name, browserState: state });
        } else {
          updatePermission(s, stream, state, `permissions:${name}`);
        }
      };
      // A passive initial prompt/unknown must not cancel the explicit in-flight prompt.
      const state = permissionState(status?.state);
      if (state === 'granted' || state === 'denied') update();
      if (live(s)) subscribe(s, status, 'change', () => { if (live(s)) update(); });
    }, () => {}); // Unsupported queries do not fabricate a grant or a denial.
  }

  function allowed(s, stream) {
    const expectedKind = mode === 'device' ? 'physical-device-review' : 'synthetic-fixture';
    return reviewed?.schema === QUALIFICATION_SCHEMA && reviewed.kind === expectedKind &&
      reviewed.disposition === 'qualified' && text(reviewed.evidenceRef) && text(contextKey) &&
      reviewed.contextKey === contextKey && reviewed.budgetRevision === limits.revision &&
      reviewed.streams?.[stream] === true;
  }

  function gate(s, stream) {
    if (!s || !live(s)) return { ok: false, reason: 'not-started' };
    if (delivering) return { ok: false, reason: 'sink-reentrancy' };
    const at = atSession(s);
    if (at.monoMs === null || s.started.monoMs === null || at.monoMs < s.started.monoMs ||
        at.monoMs - s.started.monoMs >= limits.maxSessionMs) {
      finish(s, 'duration-or-clock-budget');
      return { ok: false, reason: 'duration-or-clock-budget' };
    }
    let reason = null;
    if (!allowed(s, stream)) reason = 'unqualified';
    else if (read(() => platform.isSecureContext) !== true) reason = 'insecure-or-unknown-context';
    else if (visibility() !== 'visible') reason = 'not-visible';
    else if (read(() => platform.navigator.userActivation.isActive) !== true) reason = 'user-gesture-required';
    else if (['denied', 'revoked'].includes(s.permission[stream].state)) reason = 'permission-denied-or-revoked';
    else if (s.requests >= limits.maxRequests) reason = 'request-budget';
    if (reason) { emit(s, 'acquisition-blocked', { stream, reason }); return { ok: false, reason }; }
    s.requests += 1;
    return { ok: true };
  }

  function callback(s, token, stream) {
    if (!live(s) || s[stream] !== token || !token.active) return null;
    const at = atSession(s);
    if (visibility() !== 'visible') { finish(s, 'visibility-lost'); return null; }
    if (at.monoMs === null || s.started.monoMs === null || at.monoMs < s.started.monoMs ||
        at.monoMs - s.started.monoMs >= limits.maxSessionMs) {
      finish(s, 'duration-or-clock-budget'); return null;
    }
    s.callbacks[stream] += 1;
    if (s.callbacks[stream] > limits.maxCallbacksPerStream) {
      cancel(s, stream);
      emit(s, 'stream-stopped', { stream, reason: 'callback-budget' });
      return null;
    }
    return at;
  }

  function start(context) {
    if (delivering) throw new Error('Cannot start from the sink');
    if (current?.active) throw new Error('Stop the active session before starting another');
    for (const key of ['sessionId', 'tripId', 'revision']) {
      if (!text(context?.[key])) throw new TypeError(`${key} must be a nonempty bounded string`);
    }
    const s = {
      context: {
        sessionId: context.sessionId, tripId: context.tripId, revision: context.revision,
        truckId: text(context.truckId) ? context.truckId : null,
        country: { value: null, provenance: 'unknown' },
        timeZone: { value: null, provenance: 'unknown' }, utcOffsetMinutes: null,
      },
      generation: ++generation, active: true, started: stamp(), lastMono: null,
      permission: {
        geolocation: { state: 'unknown', browserState: 'unknown', source: 'not-queried' },
        motion: { state: 'unknown', browserState: 'unknown', source: 'not-queried' },
      },
      geo: null, motion: null, cleanups: [], permissionQueries: new Set(), events: [], dropped: 0, emitted: 0,
      requests: 0, callbacks: { geo: 0, motion: 0 }, sinkErrors: 0, cleanupErrors: 0,
      clockUncertain: false, stopReason: null, timer: null,
    };
    s.lastMono = s.started.monoMs;
    current = s;
    try {
      s.timer = platform.setTimeout(() => finish(s, 'duration-budget'), limits.maxSessionMs);
      subscribe(s, platform.document, 'visibilitychange', () => {
        if (live(s) && visibility() !== 'visible') {
          emit(s, 'visibility-lost'); finish(s, 'visibility-lost');
        }
      });
      for (const name of ['pagehide', 'freeze']) {
        subscribe(s, name === 'freeze' ? platform.document : platform, name, () => finish(s, name));
      }
      emit(s, 'session-start', { streamsDisabledUntilExplicitAcquisition: true });
    } catch (error) { finish(s, 'platform-error'); throw error; }
    return snapshot();
  }

  function acquireLocation({ watch = false, preciseConsent = null } = {}) {
    if (typeof watch !== 'boolean') throw new TypeError('watch must be boolean');
    const s = current;
    if (s?.geo) return { ok: false, reason: 'already-acquiring' };
    const result = gate(s, 'geolocation');
    if (!result.ok) return result;
    const api = read(() => platform.navigator.geolocation);
    const method = watch ? 'watchPosition' : 'getCurrentPosition';
    if (typeof api?.[method] !== 'function' || (watch && typeof api.clearWatch !== 'function')) {
      emit(s, 'acquisition-blocked', { stream: 'geolocation', reason: 'api-unavailable' });
      return { ok: false, reason: 'api-unavailable' };
    }
    const consent = preciseConsent?.granted === true && text(preciseConsent.purpose) && text(preciseConsent.reference) ?
      { purpose: preciseConsent.purpose, reference: preciseConsent.reference } : null;
    const token = { active: true, api, watchId: null, timer: null, lastEmit: null, lastSource: null };
    s.geo = token;
    const options = { enableHighAccuracy: false, maximumAge: limits.maximumAgeMs, timeout: limits.requestTimeoutMs };
    const requestId = `${s.generation}:geo:${s.requests}`;
    emit(s, 'acquisition-request', { stream: 'geolocation', requestId, watch, options });
    if (!live(s)) return { ok: false, reason: 'session-stopped' };
    observePermission(s, 'geolocation', 'geolocation');
    const success = (position) => {
      const at = callback(s, token, 'geo');
      if (!at) return;
      if (!watch) cancel(s, 'geo');
      // A successful callback is a grant at that callback, not proof of future permission.
      s.permission.geolocation = { state: 'granted', browserState: 'granted', source: 'position-callback' };
      if (token.lastEmit !== null && at.monoMs - token.lastEmit < limits.minEmitIntervalMs) return;
      token.lastEmit = at.monoMs;
      const sourceWall = finite(position?.timestamp);
      const ageMs = sourceWall === null || at.wallMs === null ? null : at.wallMs - sourceWall;
      const reordered = sourceWall !== null && token.lastSource !== null && sourceWall < token.lastSource;
      token.lastSource = sourceWall === null ? token.lastSource : Math.max(token.lastSource ?? sourceWall, sourceWall);
      const coords = position?.coords;
      const data = {
        requestId, watch, options, accuracyM: nonnegative(coords?.accuracy), ageMs,
        freshness: ageMs === null || ageMs < 0 || s.clockUncertain || limits.freshnessMs === null ? 'unknown' :
          ageMs > limits.freshnessMs ? 'stale' : 'within-provisional-budget',
        sourceOrder: sourceWall === null ? 'unknown' : reordered ? 'reordered' : 'nondecreasing',
        locationSource: 'browser-geolocation-underlying-source-unknown',
        coordinates: null, redaction: 'omitted', routeProgress: 'unknown',
      };
      if (consent) {
        data.coordinates = {
          latitude: ranged(coords?.latitude, -90, 90), longitude: ranged(coords?.longitude, -180, 180),
        };
        data.redaction = 'explicit-consent-and-purpose';
        data.consentReference = consent.reference;
        data.purpose = consent.purpose;
      }
      emit(s, 'geolocation', data, { value: sourceWall, basis: 'unix-epoch-ms', provenance: 'position.timestamp' }, at);
    };
    const failure = (error) => {
      if (!callback(s, token, 'geo')) return;
      const code = [1, 2, 3].includes(error?.code) ? error.code : null;
      if (!watch || code === 1) cancel(s, 'geo');
      if (code === 1) updatePermission(s, 'geolocation', 'denied', 'position-error', requestId);
      emit(s, 'geolocation-error', { requestId, code }); // Raw platform messages may contain sensitive context.
    };
    try {
      // Bound a one-shot even when the browser waits indefinitely for permission.
      if (!watch) token.timer = platform.setTimeout(() => {
        if (!live(s) || s.geo !== token) return;
        cancel(s, 'geo'); emit(s, 'acquisition-timeout', { requestId });
      }, limits.requestTimeoutMs);
      const id = api[method](success, failure, options);
      if (watch) {
        token.watchId = id;
        if (!live(s) || !token.active) read(() => api.clearWatch(id));
      }
    } catch {
      cancel(s, 'geo'); emit(s, 'acquisition-error', { stream: 'geolocation', requestId });
      return { ok: false, reason: 'platform-error' };
    }
    return { ok: true, requestId };
  }

  function acquireMotion() {
    const s = current;
    if (s?.motion) return Promise.resolve({ ok: false, reason: 'already-acquiring' });
    const result = gate(s, 'motion');
    if (!result.ok) return Promise.resolve(result);
    const api = read(() => platform.DeviceMotionEvent);
    if (typeof api?.requestPermission !== 'function' || !listenable(platform)) {
      emit(s, 'acquisition-blocked', { stream: 'motion', reason: 'unsupported-permission-route' });
      return Promise.resolve({ ok: false, reason: 'unsupported-permission-route' });
    }
    const token = { active: true, timer: null, handler: null, lastEmit: null };
    s.motion = token;
    const requestId = `${s.generation}:motion:${s.requests}`;
    emit(s, 'acquisition-request', { stream: 'motion', requestId });
    if (!live(s) || s.motion !== token) return Promise.resolve({ ok: false, reason: 'session-stopped' });
    let answer;
    // Invoke synchronously while transient activation is still present; do not await first.
    try { answer = api.requestPermission(); }
    catch {
      cancel(s, 'motion');
      updatePermission(s, 'motion', 'unknown', 'requestPermission-threw', requestId);
      return Promise.resolve({ ok: false, reason: 'permission-request-failed' });
    }
    token.timer = platform.setTimeout(() => {
      if (!live(s) || s.motion !== token) return;
      cancel(s, 'motion'); emit(s, 'acquisition-timeout', { requestId });
    }, limits.requestTimeoutMs);
    return Promise.resolve(answer).then((answerState) => {
      if (!live(s) || s.motion !== token) return { ok: false, reason: 'obsolete-request' };
      read(() => platform.clearTimeout(token.timer)); token.timer = null;
      const state = permissionState(answerState);
      updatePermission(s, 'motion', state, 'requestPermission', requestId);
      if (!live(s) || s.motion !== token || state !== 'granted') return { ok: false, reason: state };
      token.handler = (event) => {
        const at = callback(s, token, 'motion');
        if (!at) return;
        if (token.lastEmit !== null && at.monoMs - token.lastEmit < limits.minEmitIntervalMs) return;
        token.lastEmit = at.monoMs;
        emit(s, 'motion', {
          requestId, acceleration: vector(event.acceleration),
          accelerationIncludingGravity: vector(event.accelerationIncludingGravity),
          rotationRate: vector(event.rotationRate, ['alpha', 'beta', 'gamma']),
          intervalMs: nonnegative(event.interval), accuracy: 'unknown',
          freshness: 'unknown', candidateMotionChange: 'unclassified',
        }, { value: nonnegative(event.timeStamp), basis: 'dom-event-ms-unreconciled', provenance: 'event.timeStamp' }, at);
      };
      try { platform.addEventListener('devicemotion', token.handler); }
      catch { cancel(s, 'motion'); return { ok: false, reason: 'platform-error' }; }
      observePermission(s, 'accelerometer', 'motion');
      observePermission(s, 'gyroscope', 'motion');
      return { ok: true, requestId };
    }, () => {
      if (!live(s) || s.motion !== token) return { ok: false, reason: 'obsolete-request' };
      cancel(s, 'motion'); updatePermission(s, 'motion', 'unknown', 'requestPermission-rejected', requestId);
      return { ok: false, reason: 'permission-request-failed' };
    });
  }

  function stop() {
    const s = current;
    if (!s || !live(s)) return;
    if (!delivering) emit(s, 'session-stop');
    finish(s, 'explicit-stop');
  }

  function revokeConsent() {
    const s = current;
    if (!s || !live(s)) return;
    for (const stream of ['geolocation', 'motion']) {
      s.permission[stream] = { state: 'revoked', browserState: 'unknown', source: 'host-consent-withdrawal' };
    }
    if (!delivering) emit(s, 'consent-revoked');
    finish(s, 'consent-revoked');
  }

  function snapshot() {
    const s = current;
    return s ? copy({
      state: s.active ? 'started' : 'stopped', stopReason: s.stopReason,
      sessionId: s.context.sessionId, permission: s.permission, budget: limits,
      summary: { emitted: s.emitted, retained: s.events.length, dropped: s.dropped,
        requests: s.requests, callbacks: s.callbacks, sinkErrors: s.sinkErrors, cleanupErrors: s.cleanupErrors },
      events: s.events,
    }) : { state: 'idle', events: [] };
  }

  return { start, stop, acquireLocation, acquireMotion, revokeConsent, snapshot,
    stopLocation: () => { if (current) cancel(current, 'geo'); },
    stopMotion: () => { if (current) cancel(current, 'motion'); },
  };
}

function vector(value, keys = ['x', 'y', 'z']) {
  return Object.fromEntries(keys.map((key) => [key, finite(value?.[key])]));
}
function ranged(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}
function validateBudget(input) {
  const budget = Object.fromEntries(Object.keys(PROVISIONAL_BUDGET).map((key) => [key, input?.[key]]));
  if (!text(budget.revision)) throw new TypeError('A budget revision is required');
  const maxima = { bufferCapacity: 1000, maxEvents: 10_000, maxCallbacksPerStream: 100_000,
    maxRequests: 100, maxSessionMs: 3_600_000, minEmitIntervalMs: 60_000, requestTimeoutMs: 60_000 };
  for (const [key, max] of Object.entries(maxima)) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 1 || budget[key] > max) {
      throw new RangeError(`Invalid bounded budget: ${key}`);
    }
  }
  for (const key of ['maximumAgeMs', 'clockToleranceMs', 'freshnessMs']) {
    if (key === 'freshnessMs' && budget[key] === null) continue;
    if (nonnegative(budget[key]) === null || budget[key] > 3_600_000) throw new RangeError(`Invalid budget: ${key}`);
  }
  return Object.freeze(budget);
}
