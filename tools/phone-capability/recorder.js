// Capability recorder for ANDES #9 physical-device runs (preparatory tooling).
//
// A framework-neutral ES module for a controlled secure-context test page. It records
// what one page could observe: lifecycle events, timer ticks against two clocks, the
// browser's network signal, passive feature/permission state and, only when the caller
// explicitly asks, geolocation callbacks. Nothing starts until start() is called, and
// nothing recorded here is evidence of driver wellbeing, attention or safety.
//
//   const recorder = createRecorder({ sessionLabel: 'C02-A-1' });
//   recorder.start();                       // listeners, timer, passive permission query
//   recorder.mark('sync-start');            // align with the observer log
//   recorder.watchPosition({ maximumAge: 0 }); // optional and explicit: may show a prompt
//   recorder.stop();
//   const trace = recorder.exportTrace();   // JSON-safe; coordinates omitted by default
//
// Each observation carries `mono` (performance.now(), ms since the time origin) and
// `wall` (Date.now(), epoch ms). Comparing the two exposes suspended timers, a paused
// monotonic clock and wall-clock adjustments; the recorder reports, it does not interpret.

export const TRACE_SCHEMA = 'andes.phone-capability.trace/1';

const DOCUMENT_EVENTS = ['visibilitychange', 'freeze', 'resume'];
const WINDOW_EVENTS = ['pagehide', 'pageshow', 'focus', 'blur'];
const NETWORK_EVENTS = ['online', 'offline'];
const PERMISSION_NAMES = ['geolocation'];
const PERMISSION_STATES = ['granted', 'denied', 'prompt'];
const NOTIFICATION_STATES = ['default', 'granted', 'denied'];
const GEOLOCATION_ERRORS = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
const OPTIONAL_POSITION_FIELDS = ['altitude', 'altitudeAccuracy', 'heading', 'speed'];
const MAX_TEXT = 120;
const LIMITS = [
  'Observations describe what this page could observe. They never indicate driver wellbeing, attention or safety.',
  'A timer gap, missing observation, offline period or quiet phone is never evidence of sleep, fatigue, robbery, assault or cargo theft.',
  'navigator.onLine true only means the browser might be online. It does not prove internet or server reachability.',
  'An interval without observations is unknown, not evidence of any device or driver state.',
  'A trace alone is not physical-device evidence. Pair it with the run sheet and the independent observer log.',
];

export function createRecorder(options = {}) {
  const {
    env = globalThis,
    sessionLabel = null,
    maxObservations = 5000,
    tickIntervalMs = 1000,
    gapThresholdMs = tickIntervalMs * 2,
    staleAfterMs = null,
    rawCoordinates = false,
  } = options;

  if (
    typeof env?.performance?.now !== 'function' ||
    typeof env.Date?.now !== 'function' ||
    typeof env.setInterval !== 'function' ||
    typeof env.clearInterval !== 'function'
  ) {
    throw new TypeError('env must provide performance.now, Date.now, setInterval and clearInterval');
  }
  positiveInteger(maxObservations, 'maxObservations');
  positiveInteger(tickIntervalMs, 'tickIntervalMs');
  positiveInteger(gapThresholdMs, 'gapThresholdMs');
  if (gapThresholdMs <= tickIntervalMs) throw new RangeError('gapThresholdMs must be greater than tickIntervalMs');
  if (staleAfterMs !== null) nonNegativeFinite(staleAfterMs, 'staleAfterMs');
  if (typeof rawCoordinates !== 'boolean') throw new TypeError('rawCoordinates must be a boolean');
  if (sessionLabel !== null && typeof sessionLabel !== 'string') throw new TypeError('sessionLabel must be a string or null');
  const label = sessionLabel === null ? null : sessionLabel.slice(0, MAX_TEXT);

  let state = 'idle';
  let seq = 0;
  let dropped = 0;
  let ticks = 0;
  let sessionId = null;
  let startedAt = null;
  let stoppedAt = null;
  let environment = null;
  let capabilities = null;
  let lastTick = null;
  let intervalId = null;
  let watch = null;
  // Latest requested position options per source, kept outside the bounded buffer so the
  // acquisition settings survive eviction of the geolocation-request observation itself.
  const acquisition = { sample: null, watch: null };
  const observations = [];
  const cleanups = [];

  const now = () => ({ mono: env.performance.now(), wall: env.Date.now() });
  const visibility = () => env.document?.visibilityState ?? null;
  const onLine = () => (typeof env.navigator?.onLine === 'boolean' ? env.navigator.onLine : null);
  // IANA zone of the device at start and stop: a freight trip can cross time zones and borders.
  const timeZone = () => {
    try {
      const zone = env.Intl?.DateTimeFormat?.().resolvedOptions().timeZone;
      return typeof zone === 'string' ? zone : null;
    } catch {
      return null;
    }
  };

  function record(type, fields, at = now()) {
    if (state !== 'recording') return;
    seq += 1;
    observations.push({ seq, type, ...at, ...fields });
    // ponytail: Array#shift is O(n); fine at the default cap, use a ring buffer if caps grow far larger.
    if (observations.length > maxObservations) {
      observations.shift();
      dropped += 1;
    }
  }

  function listen(target, type, handler) {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  }

  function requireRecording(method) {
    if (state !== 'recording') throw new Error(`${method}() needs a recording session; recorder is ${state}`);
  }

  function onLifecycle(event) {
    record('lifecycle', {
      event: event.type,
      visibilityState: visibility(),
      persisted: typeof event.persisted === 'boolean' ? event.persisted : null,
      eventTimeStamp: finiteOrNull(event.timeStamp),
    });
  }

  function onNetwork(event) {
    record('network', { event: event.type, navigatorOnLine: onLine(), eventTimeStamp: finiteOrNull(event.timeStamp) });
  }

  function tick() {
    if (state !== 'recording') return;
    const at = now();
    const monoElapsedMs = at.mono - lastTick.mono;
    const wallElapsedMs = at.wall - lastTick.wall;
    lastTick = at;
    ticks += 1;
    if (monoElapsedMs >= gapThresholdMs || wallElapsedMs >= gapThresholdMs || wallElapsedMs < 0) {
      record('timer-gap', { expectedIntervalMs: tickIntervalMs, monoElapsedMs, wallElapsedMs }, at);
    }
  }

  // Permissions API query() reads state without prompting; answers arrive asynchronously.
  function queryPermissions() {
    let permissions;
    try {
      permissions = env.navigator?.permissions;
    } catch {
      return;
    }
    if (typeof permissions?.query !== 'function') return;
    for (const name of PERMISSION_NAMES) {
      let answer;
      try {
        answer = Promise.resolve(permissions.query({ name }));
      } catch (error) {
        answer = Promise.reject(error);
      }
      answer.then(
        (status) => {
          if (state !== 'recording') return;
          record('permission', { name, state: oneOf(status?.state, PERMISSION_STATES), source: 'query' });
          if (canListen(status)) {
            listen(status, 'change', () => record('permission', { name, state: oneOf(status.state, PERMISSION_STATES), source: 'change' }));
          }
        },
        (error) => record('permission', { name, state: 'unknown', source: 'query', error: errorName(error) }),
      );
    }
  }

  function geolocationApi(source) {
    let geolocation;
    try {
      geolocation = env.navigator?.geolocation;
    } catch (error) {
      record('geolocation-unavailable', { source, reason: 'threw', error: errorName(error) });
      return null;
    }
    if (typeof geolocation?.getCurrentPosition !== 'function' || typeof geolocation.watchPosition !== 'function') {
      record('geolocation-unavailable', { source, reason: 'not-exposed', error: null });
      return null;
    }
    return geolocation;
  }

  function freshness(ageMs) {
    if (staleAfterMs === null || ageMs === null || ageMs < 0) return 'unknown';
    return ageMs > staleAfterMs ? 'stale' : 'fresh';
  }

  function onPosition(source, position, options) {
    const at = now();
    const coords = position?.coords ?? {};
    const positionTimestamp = finiteOrNull(position?.timestamp);
    const ageMs = positionTimestamp === null ? null : at.wall - positionTimestamp;
    const fields = {
      source,
      options,
      accuracyM: finiteOrNull(coords.accuracy),
      positionTimestamp,
      ageMs,
      freshness: freshness(ageMs),
      providedFields: OPTIONAL_POSITION_FIELDS.filter((key) => Number.isFinite(coords[key])),
    };
    if (rawCoordinates) {
      fields.coords = {
        latitude: finiteOrNull(coords.latitude),
        longitude: finiteOrNull(coords.longitude),
        altitude: finiteOrNull(coords.altitude),
      };
    }
    record('geolocation', fields, at);
  }

  function onPositionError(source, error, options) {
    const code = Number.isInteger(error?.code) ? error.code : null;
    record('geolocation-error', {
      source,
      options,
      code,
      codeName: GEOLOCATION_ERRORS[code] ?? 'UNKNOWN',
      message: typeof error?.message === 'string' ? error.message.slice(0, MAX_TEXT) : null,
    });
  }

  function start() {
    if (state !== 'idle') throw new Error(`recorder is ${state}; create a new recorder for another session`);
    state = 'recording';
    const at = now();
    sessionId = randomId(env);
    startedAt = at;
    lastTick = at;
    environment = describeEnvironment(env);
    capabilities = detectCapabilities(env);
    record('start', { visibilityState: visibility(), navigatorOnLine: onLine(), timeZone: timeZone() }, at);
    if (canListen(env.document)) {
      for (const type of DOCUMENT_EVENTS) listen(env.document, type, onLifecycle);
    }
    if (canListen(env)) {
      for (const type of WINDOW_EVENTS) listen(env, type, onLifecycle);
      for (const type of NETWORK_EVENTS) listen(env, type, onNetwork);
    }
    intervalId = env.setInterval(tick, tickIntervalMs);
    queryPermissions();
  }

  function stop() {
    if (state !== 'recording') return;
    clearPositionWatch();
    const at = now();
    record('stop', { visibilityState: visibility(), navigatorOnLine: onLine(), timeZone: timeZone() }, at);
    stoppedAt = at;
    state = 'stopped';
    env.clearInterval(intervalId);
    for (const cleanup of cleanups.splice(0)) cleanup();
  }

  function mark(text) {
    requireRecording('mark');
    record('mark', { label: String(text).slice(0, MAX_TEXT) });
  }

  // Explicit, one-shot location request. On a device this may show the permission prompt.
  function samplePosition(positionOptions) {
    requireRecording('samplePosition');
    const request = toPositionOptions(positionOptions);
    const geolocation = geolocationApi('sample');
    if (!geolocation) return;
    record('geolocation-request', { source: 'sample', options: request });
    acquisition.sample = request;
    try {
      geolocation.getCurrentPosition((p) => onPosition('sample', p, request), (e) => onPositionError('sample', e, request), request);
    } catch (error) {
      record('geolocation-unavailable', { source: 'sample', reason: 'threw', error: errorName(error) });
    }
  }

  // Explicit position watch; stop() clears it.
  function watchPosition(positionOptions) {
    requireRecording('watchPosition');
    if (watch) throw new Error('a position watch is already active; call clearPositionWatch() first');
    const request = toPositionOptions(positionOptions);
    const geolocation = geolocationApi('watch');
    if (!geolocation) return;
    record('geolocation-request', { source: 'watch', options: request });
    acquisition.watch = request;
    try {
      const id = geolocation.watchPosition((p) => onPosition('watch', p, request), (e) => onPositionError('watch', e, request), request);
      watch = { geolocation, id };
    } catch (error) {
      record('geolocation-unavailable', { source: 'watch', reason: 'threw', error: errorName(error) });
    }
  }

  function clearPositionWatch() {
    if (!watch) return;
    const { geolocation, id } = watch;
    watch = null;
    let error = null;
    try {
      geolocation.clearWatch(id);
    } catch (thrown) {
      error = errorName(thrown);
    }
    record('geolocation-watch-cleared', { error });
  }

  function exportTrace() {
    return JSON.parse(
      JSON.stringify({
        schema: TRACE_SCHEMA,
        session: { id: sessionId, label, state, startedAt, stoppedAt },
        config: { maxObservations, tickIntervalMs, gapThresholdMs, staleAfterMs, rawCoordinates },
        acquisition: { geolocation: { sample: acquisition.sample, watch: acquisition.watch } },
        environment,
        capabilities,
        redaction: { coordinates: rawCoordinates ? 'included-by-tester-choice' : 'omitted' },
        limits: LIMITS,
        summary: { recorded: seq, retained: observations.length, dropped, ticks },
        observations,
      }),
    );
  }

  return {
    get state() {
      return state;
    },
    start,
    stop,
    mark,
    samplePosition,
    watchPosition,
    clearPositionWatch,
    exportTrace,
  };
}

function describeEnvironment(env) {
  return {
    source: env === globalThis ? 'global' : 'injected',
    physicalDeviceVerified: false, // a trace cannot prove which device or conditions produced it
    userAgent: typeof env.navigator?.userAgent === 'string' ? env.navigator.userAgent : null,
    navigatorStandalone: typeof env.navigator?.standalone === 'boolean' ? env.navigator.standalone : null,
    displayModeStandalone: mediaMatches(env, '(display-mode: standalone)'),
    timeOrigin: finiteOrNull(env.performance.timeOrigin),
  };
}

// 'exposed' means the API object exists, not that it works on this device.
// A missing owner (no navigator, no document) is 'unknown', never 'not-exposed'.
function detectCapabilities(env) {
  const nav = env.navigator;
  const doc = env.document;
  const motion = exposure(env, 'DeviceMotionEvent');
  const notification = exposure(env, 'Notification');
  return {
    secureContext: typeof env.isSecureContext === 'boolean' ? env.isSecureContext : 'unknown',
    apis: {
      geolocation: exposure(nav, 'geolocation'),
      permissions: exposure(nav, 'permissions'),
      deviceMotionEvent: motion,
      deviceMotionRequestPermission: motion === 'exposed' ? exposure(env.DeviceMotionEvent, 'requestPermission') : motion,
      notification,
      serviceWorker: exposure(nav, 'serviceWorker'),
      pushManager: exposure(env, 'PushManager'),
      wakeLock: exposure(nav, 'wakeLock'),
      batteryStatus: exposure(nav, 'getBattery'),
      networkInformation: exposure(nav, 'connection'),
      pageFreezeEvent: doc ? ('onfreeze' in doc ? 'exposed' : 'not-exposed') : 'unknown',
      visibilityState: exposure(doc, 'visibilityState'),
    },
    permissionsAtStart: {
      // Never requested here: requestPermission() needs a user gesture and would change device state.
      motion: 'unknown',
      notifications: notification === 'exposed' ? oneOf(env.Notification.permission, NOTIFICATION_STATES) : notification,
    },
  };
}

function exposure(owner, key) {
  if (owner === undefined || owner === null) return 'unknown';
  try {
    const value = owner[key];
    return value === undefined || value === null ? 'not-exposed' : 'exposed';
  } catch {
    return 'unknown';
  }
}

function mediaMatches(env, query) {
  try {
    return typeof env.matchMedia === 'function' ? Boolean(env.matchMedia(query).matches) : null;
  } catch {
    return null;
  }
}

function randomId(env) {
  try {
    return typeof env.crypto?.randomUUID === 'function' ? env.crypto.randomUUID() : null;
  } catch {
    return null;
  }
}

function toPositionOptions(input) {
  const source = input ?? {};
  const options = {};
  if (source.enableHighAccuracy !== undefined) options.enableHighAccuracy = Boolean(source.enableHighAccuracy);
  for (const key of ['maximumAge', 'timeout']) {
    if (source[key] !== undefined) options[key] = nonNegativeFinite(source[key], key);
  }
  return options;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}

function nonNegativeFinite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`);
  }
  return value;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function oneOf(value, allowed) {
  return allowed.includes(value) ? value : 'unknown';
}

function errorName(error) {
  return typeof error?.name === 'string' && error.name ? error.name : 'Error';
}

function canListen(target) {
  return typeof target?.addEventListener === 'function' && typeof target.removeEventListener === 'function';
}
