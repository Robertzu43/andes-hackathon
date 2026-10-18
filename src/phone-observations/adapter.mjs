// Local observation tooling for #19. No transport, detection or device qualification.
import { newObservationSessionId } from './session-id.mjs';
export const EVENT_SCHEMA = 'andes.phone-observations.provisional/1';
export const QUALIFICATION_SCHEMA = 'andes.phone-observations.qualification/1';

// Engineering guardrails only; #9/#11 have not accepted a capability/resource budget.
export const PROVISIONAL_BUDGET = Object.freeze({
  revision: 'engineering-only/5', bufferCapacity: 128, maxEvents: 400_000,
  maxCallbacksPerStream: 10_000_000, maxRawCallbacksPerStream: 10_000_000,
  maxRequests: 100, maxSessionMs: 86_400_000,
  minEmitIntervalMs: 1000, requestTimeoutMs: 10_000, permissionPromptTimeoutMs: 120_000, maximumAgeMs: 0,
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
const DEFAULT_CLOCK = { now: () => ({ wallMs: Date.now(), monoMs: globalThis.performance?.now() }) };
const AFTER_DELIVERY = Symbol('after-delivery');
const RESUMABLE_REASONS = new Set(['visibility-lost', 'pagehide', 'freeze', 'duration-budget', 'event-budget']);
const settleResult = (result) => result?.[AFTER_DELIVERY] ? result[AFTER_DELIVERY]() : result;

function syntheticPlatform(platform, clock) {
  if (clock === DEFAULT_CLOCK || !['navigator', 'document', 'setTimeout', 'clearTimeout']
    .every((key) => Object.hasOwn(platform, key))) return false;
  const nativeWindow = read(() => globalThis.window);
  let prototype = platform;
  for (let depth = 0; prototype; depth += 1, prototype = Object.getPrototypeOf(prototype)) {
    if (depth > 64 || prototype === globalThis || prototype === nativeWindow) return false;
  }
  const nativeNavigator = read(() => globalThis.navigator);
  const nativeDocument = read(() => globalThis.document);
  const nativeMotion = read(() => globalThis.DeviceMotionEvent);
  const nativeGeo = read(() => nativeNavigator.geolocation);
  return !(nativeNavigator && platform.navigator === nativeNavigator) &&
    !(nativeDocument && platform.document === nativeDocument) &&
    !(nativeMotion && platform.DeviceMotionEvent === nativeMotion) &&
    !(nativeGeo && read(() => platform.navigator.geolocation) === nativeGeo) &&
    platform.setTimeout !== globalThis.setTimeout && platform.clearTimeout !== globalThis.clearTimeout;
}

export function createPhoneObservationAdapter({
  platform = globalThis,
  clock = DEFAULT_CLOCK,
  sink = () => {}, mode = 'device', contextKey = null, qualification = null,
  budget = PROVISIONAL_BUDGET,
} = {}) {
  if (!['device', 'synthetic-test'].includes(mode)) throw new TypeError('Invalid mode');
  if (mode === 'synthetic-test' && !syntheticPlatform(platform, clock)) {
    throw new TypeError('Synthetic mode requires detached injected platform and clock');
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
  let gestureDepth = 0;
  let transitionDepth = 0;
  const deliveries = [];
  const instanceId = newObservationSessionId();

  const visibility = () => read(() => platform.document.visibilityState, 'unknown');
  const live = (s) => current === s && s.active;
  const activated = () => gestureDepth > 0 || read(() => platform.navigator.userActivation.isActive) === true;
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

  function transition(action) {
    transitionDepth += 1;
    let result;
    try { result = action(); }
    finally { transitionDepth -= 1; if (transitionDepth === 0) flushEvents(); }
    return settleResult(result);
  }

  function flushEvents() {
    if (delivering) return;
    delivering = true;
    try {
      while (deliveries.length) {
        const { session: s, event } = deliveries.shift();
        try {
          const result = sink(copy(event));
          if (result && typeof result.then === 'function') {
            s.sinkErrors += 1; Promise.resolve(result).catch(() => {});
          }
        } catch { s.sinkErrors += 1; }
      }
    } finally { delivering = false; }
  }

  function emit(s, type, data = {}, sourceTime = null, at = atSession(s), terminal = false) {
    if (!terminal && (!live(s) || s.emitted >= limits.maxEvents)) return;
    sequence += 1;
    s.emitted += 1;
    const event = {
      schema: EVENT_SCHEMA, category: 'phone-observation', type,
      eventId: `${instanceId}:${s.generation}:${sequence}`,
      ...s.context, sequence, sessionSequence: s.emitted,
      sourceTime, clientReceiptTime: at, serverReceiptTime: null,
      revision: s.context.revision, policyVersion: null,
      budgetRevision: limits.revision, visibility: visibility(),
      permission: s.permission,
      provenance: {
        mode, qualificationEvidence: text(reviewed?.evidenceRef) ? reviewed.evidenceRef : null,
        contextKey: text(contextKey) ? contextKey : null,
        boundary: 'provisional-client-only', clock: 'device-unreconciled',
        clockUncertain: s.clockUncertain, serverLatency: 'unknown',
      },
      interpretation: 'observation-only', data,
    };
    if (s.events.length === limits.bufferCapacity) { s.events.shift(); s.dropped += 1; }
    const retained = copy(event);
    s.events.push(retained);
    // Capture once, deliver a detached copy only at a settled transition boundary.
    deliveries.push({ session: s, event: retained });
    if (!terminal && live(s) && s.emitted >= limits.maxEvents) finish(s, 'event-budget');
  }

  function subscribe(s, target, name, handler) {
    if (!listenable(target)) return false;
    const listener = (...args) => transition(() => handler(...args));
    target.addEventListener(name, listener);
    s.cleanups.push(() => target.removeEventListener(name, listener));
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
    if (current !== s) return;
    if (!live(s)) {
      // A later explicit action must replace the sink's suspended intent too.
      // Only one final update is allowed; reentrant/repeated stops are inert.
      if (!RESUMABLE_REASONS.has(s.stopReason) ||
          !['explicit-stop', 'consent-revoked'].includes(reason)) return;
    }
    s.active = false;
    s.stopReason = reason;
    cancel(s, 'geo');
    cancel(s, 'motion');
    releaseWakeLock(s);
    read(() => platform.clearTimeout(s.timer));
    for (const cleanup of s.cleanups.splice(0)) {
      if (!read(() => { cleanup(); return true; }, false)) s.cleanupErrors += 1;
    }
    // Reserve a terminal emission beyond the ordinary cap, plus at most one
    // nonresumable intent update. Invalidate before reentrant sink delivery.
    emit(s, 'session-stop', { reason, sharingState: 'stopped',
      resumable: RESUMABLE_REASONS.has(reason) },
    null, atSession(s), true);
  }

  function releaseWakeLock(s, reason = 'session-stopped') {
    const token = s.wakeLock;
    s.wakeLock = null;
    if (token) {
      token.active = false;
      read(() => platform.clearTimeout(token.timer));
      token.resolve({ ok: false, reason });
    }
    if (token?.sentinel) Promise.resolve(read(() => token.sentinel.release())).catch(() => {});
  }

  function updatePermission(s, stream, browserState, source, requestId = null) {
    if (!live(s)) return;
    const old = s.permission[stream];
    if (['denied', 'revoked'].includes(old.state)) {
      // Later monitor answers remain evidence, but cannot reopen this session's gate.
      emit(s, 'permission-observed', { stream, browserState, source, requestId,
        applied: false, reason: 'terminal-session-permission' });
      return;
    }
    const state = old.state === 'granted' && browserState !== 'granted' ? 'revoked' : browserState;
    s.permission[stream] = { state, browserState, source };
    if (state !== 'granted') cancel(s, stream === 'geolocation' ? 'geo' : 'motion');
    emit(s, 'permission', { stream, state, browserState, source, requestId });
    if (stream === 'geolocation' && state === 'granted') s.geo?.armGrantedTimeout?.();
  }

  function observePermission(s, name, stream) {
    if (s.permissionQueries.has(name)) return;
    s.permissionQueries.add(name);
    const epoch = s.permissionEpoch[stream];
    queryPermission(s, name, (status) => {
      s.permissionStatuses.set(name, status);
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
      if (state === 'denied' || (state === 'granted' && epoch === s.permissionEpoch[stream])) update();
      if (live(s)) subscribe(s, status, 'change', () => { if (live(s)) update(); });
    });
  }

  function queryPermission(s, name, apply) {
    const permissions = read(() => platform.navigator.permissions);
    if (typeof permissions?.query !== 'function') return;
    let pending;
    try { pending = permissions.query({ name }); }
    catch (error) { permissionQueryFailure(s, error); return; }
    Promise.resolve(pending).then((status) => transition(() => {
      if (live(s)) apply(status);
    }), (error) => permissionQueryFailure(s, error)).catch(() => {
      s.permissionObserverErrors += 1; // Fulfilment/listener faults are not unsupported-query results.
    });
  }

  function permissionQueryFailure(s, error) {
    if (['TypeError', 'NotSupportedError'].includes(error?.name)) s.unsupportedPermissionQueries += 1;
    else s.permissionObserverErrors += 1;
  }

  function ambiguousLocationDenial(s, requestId) {
    const epoch = ++s.permissionEpoch.geolocation;
    const requestGeneration = s.locationRequestGeneration;
    s.locationNeedsGesture = true;
    const status = s.permissionStatuses.get('geolocation');
    if (permissionState(read(() => status.state)) === 'denied') {
      updatePermission(s, 'geolocation', 'denied', 'permissions:geolocation', requestId);
      return;
    }
    // Code 1 alone also covers prompt dismissal / policy failure. It proves no
    // grant, but cannot establish a persistent user denial.
    s.permission.geolocation = { state: 'unknown', browserState: 'unknown', source: 'position-error-ambiguous' };
    emit(s, 'permission-observed', { stream: 'geolocation', browserState: 'unknown',
      source: 'position-error-ambiguous', requestId });
    queryPermission(s, 'geolocation', (fresh) => {
      if (s.permissionEpoch.geolocation !== epoch || s.locationRequestGeneration !== requestGeneration) return;
      updatePermission(s, 'geolocation', permissionState(fresh?.state), 'permissions:geolocation-after-error', requestId);
    });
  }

  function obsoleteReason(s) { return live(s) ? 'obsolete-request' : 'session-stopped'; }

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
    if (mode === 'synthetic-test' && !syntheticPlatform(platform, clock)) reason = 'synthetic-platform-not-detached';
    else if (!allowed(s, stream === 'wake-lock' ? 'geolocation' : stream)) reason = 'unqualified';
    else if (read(() => platform.isSecureContext) !== true) reason = 'insecure-or-unknown-context';
    else if (visibility() !== 'visible') reason = 'not-visible';
    else if (stream !== 'wake-lock' && !activated() && (s.permission[stream].state !== 'granted' ||
        (stream === 'geolocation' && s.locationNeedsGesture))) reason = 'user-gesture-required';
    else if (stream !== 'wake-lock' && ['denied', 'revoked'].includes(s.permission[stream].state)) reason = 'permission-denied-or-revoked';
    else if (s.requests >= limits.maxRequests) reason = 'request-budget';
    if (reason) return acquisitionBlocked(s, stream, reason);
    return { ok: true };
  }

  function acquisitionBlocked(s, stream, reason) {
    diagnostic(s, `${stream}:${reason}`, 'acquisition-blocked', { stream, reason });
    return { ok: false, reason };
  }

  function diagnostic(s, key, type, data) {
    if (s.blockedDiagnostics.has(key)) s.suppressedBlocked += 1;
    else { s.blockedDiagnostics.add(key); emit(s, type, data); }
  }

  function requestTime(s, token, stream) {
    if (!live(s) || s[stream] !== token || !token.active) return null;
    const at = atSession(s);
    if (visibility() !== 'visible') { finish(s, 'visibility-lost'); return null; }
    if (at.monoMs === null || s.started.monoMs === null || at.monoMs < s.started.monoMs ||
        at.monoMs - s.started.monoMs >= limits.maxSessionMs) {
      finish(s, 'duration-or-clock-budget'); return null;
    }
    return at;
  }

  function callback(s, token, stream) {
    const at = requestTime(s, token, stream);
    if (!at) return null;
    s.callbacks[stream] += 1;
    let reason = null;
    if (s.callbacks[stream] > limits.maxRawCallbacksPerStream) reason = 'raw-callback-budget';
    else if (stream === 'motion' && token.lastEmit !== null &&
        at.monoMs - token.lastEmit < limits.minEmitIntervalMs) {
      s.suppressedMotion += 1;
      return null;
    } else if (++s.processedCallbacks[stream] > limits.maxCallbacksPerStream) reason = 'callback-budget';
    if (reason) {
      cancel(s, stream);
      emit(s, 'stream-stopped', { stream: stream === 'geo' ? 'geolocation' : stream, reason });
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
      permissionEpoch: { geolocation: 0, motion: 0 }, permissionStatuses: new Map(),
      locationRequestGeneration: 0,
      requests: 0, callbacks: { geo: 0, motion: 0 }, sinkErrors: 0, cleanupErrors: 0, suppressedErrors: 0,
      processedCallbacks: { geo: 0, motion: 0 }, suppressedMotion: 0,
      blockedDiagnostics: new Set(), suppressedBlocked: 0,
      clockUncertain: false, stopReason: null, timer: null, permissionObserverErrors: 0,
      unsupportedPermissionQueries: 0, locationNeedsGesture: false, consentWithdrawn: false,
      locationIntent: null, motionIntent: false, wakeIntent: false, wakeLock: null,
    };
    s.lastMono = s.started.monoMs;
    current = s;
    try {
      s.timer = platform.setTimeout(() => transition(() => finish(s, 'duration-budget')), limits.maxSessionMs);
      subscribe(s, platform.document, 'visibilitychange', () => {
        if (live(s) && visibility() !== 'visible') {
          finish(s, 'visibility-lost');
        }
      });
      for (const name of ['pagehide', 'freeze']) {
        subscribe(s, name === 'freeze' ? platform.document : platform, name, () => finish(s, name));
      }
      emit(s, 'session-start', { streamsDisabledUntilExplicitAcquisition: true });
    } catch (error) { finish(s, 'platform-error'); throw error; }
    return snapshot();
  }

  function acquireLocation({ watch = false, preciseConsent = null, enableHighAccuracy = true } = {}) {
    if (typeof watch !== 'boolean') throw new TypeError('watch must be boolean');
    if (typeof enableHighAccuracy !== 'boolean') throw new TypeError('enableHighAccuracy must be boolean');
    const s = current;
    if (s?.geo) return { ok: false, reason: 'already-acquiring' };
    const result = gate(s, 'geolocation');
    if (!result.ok) return result;
    const api = read(() => platform.navigator.geolocation);
    const method = watch ? 'watchPosition' : 'getCurrentPosition';
    if (typeof api?.[method] !== 'function' || (watch && typeof api.clearWatch !== 'function')) {
      return acquisitionBlocked(s, 'geolocation', 'api-unavailable');
    }
    s.requests += 1;
    s.locationRequestGeneration += 1;
    const consent = preciseConsent?.granted === true && text(preciseConsent.purpose) && text(preciseConsent.reference) ?
      { purpose: preciseConsent.purpose, reference: preciseConsent.reference } : null;
    s.locationIntent = { watch, preciseConsent: consent ? { granted: true, ...consent } : null, enableHighAccuracy };
    const token = { active: true, api, watchId: null, timer: null, lastEmit: null, lastError: null, lastSource: null,
      completed: false, failureReason: null, phase: null, deadline: null, armGrantedTimeout: null };
    s.geo = token;
    const options = { enableHighAccuracy, maximumAge: limits.maximumAgeMs, timeout: limits.requestTimeoutMs };
    const requestId = `${s.generation}:geo:${s.requests}`;
    emit(s, 'acquisition-request', { stream: 'geolocation', requestId, watch, options });
    flushEvents(); // Settled request-created phase; the consumer may withdraw before the native call.
    if (!requestTime(s, token, 'geo')) return { ok: false, reason: live(s) ? 'obsolete-request' : 'session-stopped' };
    function timeout(reason) {
      if (!live(s) || s.geo !== token) return;
      token.failureReason = reason;
      cancel(s, 'geo'); emit(s, 'acquisition-timeout', { requestId, watch, options, reason });
    }
    function arm(phase) {
      if (watch || !live(s) || s.geo !== token || token.phase === phase) return true;
      const at = requestTime(s, token, 'geo');
      if (!at) return false;
      read(() => platform.clearTimeout(token.timer));
      token.phase = phase;
      const duration = phase === 'awaiting-permission' ? limits.permissionPromptTimeoutMs : limits.requestTimeoutMs;
      token.deadline = at.monoMs + duration;
      try {
        token.timer = platform.setTimeout(() => transition(() => timeout(phase === 'awaiting-permission' ?
          'permission-prompt-timeout' : 'acquisition-timeout')), duration);
      } catch {
        token.failureReason = 'timer-unavailable'; cancel(s, 'geo');
        emit(s, 'acquisition-error', { stream: 'geolocation', requestId, watch, options, reason: 'timer-unavailable' });
        return false;
      }
      return true;
    }
    token.armGrantedTimeout = () => arm('acquiring');
    observePermission(s, 'geolocation', 'geolocation');
    if (!requestTime(s, token, 'geo')) return { ok: false, reason: live(s) ? 'obsolete-request' : 'session-stopped' };
    const success = (position) => transition(() => {
      const at = callback(s, token, 'geo');
      if (!at) return;
      if (!watch && token.deadline !== null && at.monoMs >= token.deadline) {
        timeout(token.phase === 'awaiting-permission' ? 'permission-prompt-timeout' : 'acquisition-timeout'); return;
      }
      token.completed = true;
      s.locationNeedsGesture = false;
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
    });
    const failure = (error) => transition(() => {
      const at = callback(s, token, 'geo');
      if (!at) return;
      const code = [1, 2, 3].includes(error?.code) ? error.code : null;
      if (!watch || code === 1) token.failureReason = code === 1 ? 'permission-not-granted' : 'geolocation-error';
      if (!watch || code === 1) cancel(s, 'geo');
      if (code === 1) ambiguousLocationDenial(s, requestId);
      if (code !== 1 && token.lastError !== null && at.monoMs - token.lastError < limits.minEmitIntervalMs) {
        s.suppressedErrors += 1; return;
      }
      token.lastError = at.monoMs;
      emit(s, 'geolocation-error', { requestId, watch, options, code }); // Omit sensitive raw platform messages.
    });
    try {
      // Permission waiting and post-grant acquisition have separate bounds.
      if (!arm(s.permission.geolocation.state === 'granted' ? 'acquiring' : 'awaiting-permission')) {
        return { ok: false, reason: 'timer-unavailable', requestId };
      }
      const id = api[method](success, failure, options);
      if (watch) {
        token.watchId = id;
        if (!live(s) || !token.active) read(() => api.clearWatch(id));
      }
    } catch {
      cancel(s, 'geo'); emit(s, 'acquisition-error', { stream: 'geolocation', requestId, watch, options });
      return { ok: false, reason: 'platform-error' };
    }
    return { [AFTER_DELIVERY]: () => !live(s) ? { ok: false, reason: 'session-stopped', requestId } :
      token.failureReason ? { ok: false, reason: token.failureReason, requestId } :
      !token.active && (watch || !token.completed) ? { ok: false, reason: 'obsolete-request', requestId } : { ok: true, requestId } };
  }

  function acquireMotion() {
    const s = current;
    if (s?.motion) return Promise.resolve({ ok: false, reason: 'already-acquiring' });
    const result = gate(s, 'motion');
    if (!result.ok) return Promise.resolve(result);
    const api = read(() => platform.DeviceMotionEvent);
    if (!api || !listenable(platform)) {
      return Promise.resolve(acquisitionBlocked(s, 'motion', 'unsupported-permission-route'));
    }
    s.requests += 1;
    s.motionIntent = true;
    const token = { active: true, timer: null, handler: null, lastEmit: null };
    s.motion = token;
    const requestId = `${s.generation}:motion:${s.requests}`;
    emit(s, 'acquisition-request', { stream: 'motion', requestId });
    flushEvents(); // Settled request-created phase, still inside the explicit gesture.
    const requestedAt = requestTime(s, token, 'motion');
    if (!requestedAt) return Promise.resolve({ ok: false, reason: obsoleteReason(s) });
    function pendingTime() {
      const at = requestTime(s, token, 'motion');
      if (!at) return null;
      const elapsed = at.monoMs - requestedAt.monoMs;
      if (elapsed < 0) {
        token.failureReason = 'clock-regressed'; cancel(s, 'motion');
        emit(s, 'acquisition-error', { stream: 'motion', requestId, reason: 'clock-regressed' }); return null;
      }
      if (elapsed >= limits.permissionPromptTimeoutMs) {
        token.failureReason = 'permission-prompt-timeout';
        cancel(s, 'motion'); emit(s, 'acquisition-timeout', { requestId, reason: token.failureReason });
        return null;
      }
      return at;
    }
    let answer;
    // Invoke synchronously while transient activation is still present; do not await first.
    const explicitPermission = typeof api.requestPermission === 'function';
    try { answer = explicitPermission ? api.requestPermission() : 'browser-managed'; }
    catch {
      cancel(s, 'motion');
      updatePermission(s, 'motion', 'unknown', 'requestPermission-threw', requestId);
      return Promise.resolve({ ok: false, reason: 'permission-request-failed' });
    }
    try {
      token.timer = platform.setTimeout(() => transition(() => {
        if (!live(s) || s.motion !== token) return;
        token.failureReason = 'permission-prompt-timeout';
        cancel(s, 'motion'); emit(s, 'acquisition-timeout', { requestId, reason: token.failureReason });
      }), limits.permissionPromptTimeoutMs);
    } catch {
      Promise.resolve(answer).catch(() => {}); cancel(s, 'motion');
      emit(s, 'acquisition-error', { stream: 'motion', requestId, reason: 'timer-unavailable' });
      return Promise.resolve({ ok: false, reason: 'timer-unavailable' });
    }
    return Promise.resolve(answer).then((answerState) => transition(() => {
      if (!pendingTime()) return { ok: false, reason: token.failureReason ?? obsoleteReason(s) };
      read(() => platform.clearTimeout(token.timer)); token.timer = null;
      const state = explicitPermission ? permissionState(answerState) : 'unknown';
      if (explicitPermission) {
        updatePermission(s, 'motion', state, 'requestPermission', requestId);
        if (state !== 'granted') return { ok: false, reason: state };
      } else {
        // Method absence is not a grant. The browser controls whether events arrive.
        emit(s, 'permission-observed', { stream: 'motion', browserState: 'unknown', source: 'browser-managed' });
      }
      flushEvents(); // Permission observation is settled before deciding whether to subscribe.
      // Permission delivery invokes the local sink; revalidate after that reentrant boundary.
      if (!pendingTime()) return { ok: false, reason: token.failureReason ?? obsoleteReason(s) };
      token.handler = (event) => transition(() => {
        const at = callback(s, token, 'motion');
        if (!at) return;
        token.lastEmit = at.monoMs;
        emit(s, 'motion', {
          requestId, acceleration: vector(event.acceleration),
          accelerationIncludingGravity: vector(event.accelerationIncludingGravity),
          rotationRate: vector(event.rotationRate, ['alpha', 'beta', 'gamma']),
          intervalMs: nonnegative(event.interval), accuracy: 'unknown',
          freshness: 'unknown', candidateMotionChange: 'unclassified',
        }, { value: nonnegative(event.timeStamp), basis: 'dom-event-ms-unreconciled', provenance: 'event.timeStamp' }, at);
      });
      try { platform.addEventListener('devicemotion', token.handler); }
      catch { cancel(s, 'motion'); return { ok: false, reason: 'platform-error' }; }
      observePermission(s, 'accelerometer', 'motion');
      observePermission(s, 'gyroscope', 'motion');
      return { [AFTER_DELIVERY]: () => live(s) && s.motion === token && token.active ?
        { ok: true, requestId } : { ok: false, reason: obsoleteReason(s), requestId } };
    }), () => transition(() => {
      if (!pendingTime()) return { ok: false, reason: token.failureReason ?? obsoleteReason(s) };
      cancel(s, 'motion'); updatePermission(s, 'motion', 'unknown', 'requestPermission-rejected', requestId);
      return { ok: false, reason: 'permission-request-failed' };
    })).catch(() => transition(() => {
      cancel(s, 'motion'); emit(s, 'acquisition-error', { stream: 'motion', requestId, reason: 'platform-error' });
      return { ok: false, reason: 'platform-error' };
    }));
  }

  function withUserGesture(event, action) {
    const EventType = read(() => platform.Event);
    const pointer = ['click', 'pointerup', 'touchend'].includes(event?.type);
    const keyboard = event?.type === 'keydown' && ['Enter', ' '].includes(event?.key);
    if (typeof action !== 'function' || typeof EventType !== 'function' || !(event instanceof EventType) ||
        event.isTrusted !== true || !event.currentTarget || ![1, 2, 3].includes(event.eventPhase) ||
        (!pointer && !keyboard)) return { ok: false, reason: 'trusted-dispatch-required' };
    gestureDepth += 1;
    try { return action(); } finally { gestureDepth -= 1; }
  }

  function requestWakeLock() {
    const s = current;
    if (s?.wakeLock) return Promise.resolve({ ok: false, reason: 'already-acquiring' });
    const result = gate(s, 'wake-lock');
    if (!result.ok) return Promise.resolve(result);
    const api = read(() => platform.navigator.wakeLock);
    s.wakeIntent = true;
    if (typeof api?.request !== 'function') {
      diagnostic(s, 'wake-lock:api-unavailable', 'wake-lock', { state: 'unavailable', reason: 'api-unavailable' });
      return Promise.resolve({ ok: false, reason: 'api-unavailable' });
    }
    s.requests += 1;
    return new Promise((resolve) => {
      const token = { active: true, sentinel: null, timer: null, resolve };
      s.wakeLock = token;
      emit(s, 'wake-lock', { state: 'requested' });
      const requestedAt = requestTime(s, token, 'wakeLock');
      if (!requestedAt) { resolve({ ok: false, reason: 'session-stopped' }); return; }
      const fail = (reason) => {
        if (s.wakeLock !== token) return;
        releaseWakeLock(s, reason);
        emit(s, 'wake-lock', { state: 'unavailable', reason });
      };
      try { token.timer = platform.setTimeout(() => transition(() => fail('request-timeout')), limits.requestTimeoutMs); }
      catch { fail('timer-unavailable'); return; }
      let pending;
      try { pending = api.request('screen'); }
      catch { fail('request-failed'); return; }
      Promise.resolve(pending).then((sentinel) => transition(() => {
        const at = requestTime(s, token, 'wakeLock');
        if (!at) {
          Promise.resolve(read(() => sentinel?.release())).catch(() => {});
          return;
        }
        const elapsed = at.monoMs - requestedAt.monoMs;
        if (elapsed < 0 || elapsed >= limits.requestTimeoutMs) {
          Promise.resolve(read(() => sentinel?.release())).catch(() => {});
          fail('request-timeout'); return;
        }
        if (typeof sentinel?.release !== 'function' || sentinel.released === true || !listenable(sentinel)) {
          Promise.resolve(read(() => sentinel?.release())).catch(() => {});
          fail('unavailable'); return;
        }
        read(() => platform.clearTimeout(token.timer)); token.timer = null;
        token.sentinel = sentinel;
        subscribe(s, sentinel, 'release', () => {
          if (live(s) && s.wakeLock === token) {
            s.wakeLock = null; token.active = false;
            emit(s, 'wake-lock', { state: 'released', reason: 'browser-release' });
          }
        });
        emit(s, 'wake-lock', { state: 'held', scope: 'visible-screen-only' });
        resolve(live(s) && s.wakeLock === token ? { ok: true } : { ok: false, reason: 'session-stopped' });
      }), () => transition(() => fail('request-failed'))).catch(() => transition(() => fail('platform-error')));
    });
  }

  function resume() {
    const previous = current;
    if (delivering || !previous || previous.active) return Promise.resolve({ ok: false, reason: 'not-suspended' });
    if (!RESUMABLE_REASONS.has(previous.stopReason)) {
      return Promise.resolve({ ok: false, reason: 'not-resumable' });
    }
    if (!activated()) return Promise.resolve({ ok: false, reason: 'user-gesture-required' });
    if (visibility() !== 'visible') return Promise.resolve({ ok: false, reason: 'not-visible' });
    if (previous.consentWithdrawn) return Promise.resolve({ ok: false, reason: 'permission-denied-or-revoked' });
    const blocked = stream => ['denied', 'revoked'].includes(previous.permission[stream].state);
    if (blocked('geolocation') ||
        (!previous.locationIntent && previous.motionIntent && blocked('motion'))) {
      return Promise.resolve({ ok: false, reason: 'permission-denied-or-revoked' });
    }
    start({ ...previous.context, sessionId: newObservationSessionId() });
    const resumed = current;
    if (blocked('motion')) resumed.permission.motion = copy(previous.permission.motion);
    const pendingLocation = previous.locationIntent ? acquireLocation(previous.locationIntent) : null;
    const motion = previous.motionIntent ? blocked('motion') ?
      Promise.resolve({ ok: false, reason: 'permission-denied-or-revoked' }) : acquireMotion() : null;
    const wakeLock = previous.wakeIntent ? requestWakeLock() : null;
    return Promise.all([motion, wakeLock]).then(([motion, wakeLock]) => {
      const location = settleResult(pendingLocation);
      return { ok: live(resumed) && (location ? location.ok : !motion || motion.ok), location, motion, wakeLock };
    });
  }

  function stop() {
    const s = current;
    if (!s) return;
    s.locationIntent = null; s.motionIntent = false; s.wakeIntent = false;
    finish(s, 'explicit-stop');
  }

  function revokeConsent() {
    const s = current;
    if (!s) return;
    s.consentWithdrawn = true;
    // Withdrawal also purges a previously stopped session. Copies already handed
    // to a consumer require that consumer's independent deletion/revocation path.
    for (const event of s.events) {
      if (event.type === 'geolocation') {
        event.data.coordinates = null; event.data.redaction = 'consent-withdrawn';
      }
    }
    for (const item of deliveries) {
      if (item.session === s && item.event.type === 'geolocation') {
        item.event.data.coordinates = null; item.event.data.redaction = 'consent-withdrawn';
      }
    }
    s.locationIntent = null; s.motionIntent = false; s.wakeIntent = false;
    for (const stream of ['geolocation', 'motion']) {
      s.permission[stream] = { state: 'revoked', browserState: 'unknown', source: 'host-consent-withdrawal' };
    }
    if (live(s) && !delivering && s.emitted + 1 < limits.maxEvents) emit(s, 'consent-revoked');
    finish(s, 'consent-revoked');
  }

  function snapshot() {
    const s = current;
    return s ? copy({
      state: s.active ? 'started' : 'stopped', stopReason: s.stopReason,
      sessionId: s.context.sessionId, permission: s.permission, budget: limits,
      locationNeedsGesture: s.locationNeedsGesture,
      summary: { emitted: s.emitted, retained: s.events.length, dropped: s.dropped,
        requests: s.requests, callbacks: s.callbacks, sinkErrors: s.sinkErrors, cleanupErrors: s.cleanupErrors,
        processedCallbacks: s.processedCallbacks, suppressedMotion: s.suppressedMotion,
        suppressedErrors: s.suppressedErrors, suppressedBlocked: s.suppressedBlocked,
        permissionObserverErrors: s.permissionObserverErrors, unsupportedPermissionQueries: s.unsupportedPermissionQueries },
      events: s.events,
    }) : { state: 'idle', events: [] };
  }

  return { start: (context) => transition(() => start(context)), stop: () => transition(stop),
    resume: () => transition(resume), withUserGesture,
    requestWakeLock: () => transition(requestWakeLock),
    acquireLocation: (options) => transition(() => acquireLocation(options)),
    acquireMotion: () => transition(acquireMotion), revokeConsent: () => transition(revokeConsent), snapshot,
    getState: () => current ? current.active ? 'started' : 'stopped' : 'idle',
    stopLocation: () => transition(() => { if (current) { current.locationIntent = null; cancel(current, 'geo'); } }),
    stopMotion: () => transition(() => { if (current) { current.motionIntent = false; cancel(current, 'motion'); } }),
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
  const maxima = { bufferCapacity: 1000, maxEvents: 2_000_000, maxCallbacksPerStream: 100_000_000,
    maxRawCallbacksPerStream: 100_000_000,
    maxRequests: 1000, maxSessionMs: 604_800_000, minEmitIntervalMs: 60_000, requestTimeoutMs: 60_000,
    permissionPromptTimeoutMs: 300_000 };
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
