// Deterministic checks for the ANDES #9 capability recorder.
// Every test runs against a synthetic environment: it proves recorder logic only,
// never how Safari or an iPhone behaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../../tools/phone-capability/recorder.js';

const WALL0 = Date.UTC(2026, 9, 17, 15, 0, 0);

// EventTarget that counts live listeners, so cleanup can be checked directly.
class CountingTarget extends EventTarget {
  listeners = 0;
  addEventListener(type, listener, options) {
    this.listeners += 1;
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners -= 1;
    super.removeEventListener(type, listener, options);
  }
}

function fakeBrowser({ geolocation = true, permissions = true } = {}) {
  const win = new CountingTarget();
  const doc = new CountingTarget();
  doc.visibilityState = 'visible';
  let mono = 500;
  let wall = WALL0;
  let timeZone = 'America/Lima';
  const timers = new Map();
  let nextTimer = 1;
  const geo = {
    requests: [],
    watches: new Map(),
    cleared: [],
    getCurrentPosition(success, failure, options) {
      geo.requests.push({ success, failure, options });
    },
    watchPosition(success, failure, options) {
      const id = 40 + geo.watches.size + geo.cleared.length + 1;
      geo.watches.set(id, { success, failure, options });
      return id;
    },
    clearWatch(id) {
      geo.cleared.push(id);
      geo.watches.delete(id);
    },
  };
  const status = Object.assign(new CountingTarget(), { name: 'geolocation', state: 'prompt' });
  const queries = [];
  const navigator = { onLine: true, userAgent: 'FakeBrowser/1.0' };
  if (geolocation) navigator.geolocation = geo;
  if (permissions) {
    navigator.permissions = {
      async query(descriptor) {
        queries.push(descriptor.name);
        return status;
      },
    };
  }
  Object.assign(win, {
    document: doc,
    navigator,
    performance: { now: () => mono, timeOrigin: WALL0 - 500 },
    Date: { now: () => wall },
    setInterval(fn, ms) {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      timers.delete(id);
    },
    isSecureContext: true,
    crypto: { randomUUID: () => 'session-uuid' },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone }) }) },
  });
  return {
    env: win,
    doc,
    geo,
    status,
    queries,
    timers,
    advance(monoMs, wallMs = monoMs) {
      mono += monoMs;
      wall += wallMs;
    },
    setTimeZone(zone) {
      timeZone = zone;
    },
    tick() {
      for (const { fn } of [...timers.values()]) fn();
    },
    dispatch(target, type, props = {}) {
      const event = new Event(type);
      for (const [key, value] of Object.entries(props)) Object.defineProperty(event, key, { value });
      target.dispatchEvent(event);
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const ofType = (trace, type) => trace.observations.filter((o) => o.type === type);
const timeoutHandles = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

test('nothing is attached, scheduled or queried before start()', async () => {
  const b = fakeBrowser();
  const recorder = createRecorder({ env: b.env });
  await settle();
  assert.equal(recorder.state, 'idle');
  assert.equal(b.timers.size, 0);
  assert.equal(b.doc.listeners + b.env.listeners, 0);
  assert.deepEqual(b.queries, []);
  assert.deepEqual(recorder.exportTrace().observations, []);
});

test('start() records both clocks and the page state, then ticks at the configured interval', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, sessionLabel: 'R01 foreground', tickIntervalMs: 250, gapThresholdMs: 1000 });
  recorder.start();
  const trace = recorder.exportTrace();
  assert.equal(recorder.state, 'recording');
  assert.deepEqual(trace.observations, [
    { seq: 1, type: 'start', mono: 500, wall: WALL0, visibilityState: 'visible', navigatorOnLine: true, timeZone: 'America/Lima' },
  ]);
  assert.deepEqual(trace.session, {
    id: 'session-uuid',
    label: 'R01 foreground',
    state: 'recording',
    startedAt: { mono: 500, wall: WALL0 },
    stoppedAt: null,
  });
  assert.deepEqual([...b.timers.values()].map((t) => t.ms), [250]);
});

test('start and stop record the device time zone, so a cross-border zone change is visible', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  b.setTimeZone('America/Sao_Paulo');
  recorder.stop();
  assert.deepEqual(
    recorder.exportTrace().observations.map((o) => [o.type, o.timeZone]),
    [['start', 'America/Lima'], ['stop', 'America/Sao_Paulo']],
  );
});

test('an unreadable time zone is recorded as null', () => {
  const b = fakeBrowser({ permissions: false });
  b.env.Intl = {
    DateTimeFormat() {
      throw new RangeError('no time zone data');
    },
  };
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  assert.equal(recorder.exportTrace().observations[0].timeZone, null);
});

test('start() twice throws and a stopped recorder cannot restart', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  assert.throws(() => recorder.start(), /recording/);
  recorder.stop();
  assert.throws(() => recorder.start(), /stopped/);
});

test('stop() is idempotent, records once and freezes the trace', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  b.advance(100);
  recorder.stop();
  recorder.stop();
  b.dispatch(b.doc, 'visibilitychange');
  const trace = recorder.exportTrace();
  assert.equal(recorder.state, 'stopped');
  assert.deepEqual(trace.observations.map((o) => o.type), ['start', 'stop']);
  assert.deepEqual(trace.session.stoppedAt, { mono: 600, wall: WALL0 + 100 });
});

test('lifecycle and network events become observations with their own event timestamps', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  b.advance(10);
  b.doc.visibilityState = 'hidden';
  b.dispatch(b.doc, 'visibilitychange', { timeStamp: 505 });
  b.advance(10);
  b.dispatch(b.env, 'pagehide', { persisted: true, timeStamp: 515 });
  b.advance(10);
  b.env.navigator.onLine = false;
  b.dispatch(b.env, 'offline', { timeStamp: 525 });
  b.advance(10);
  b.dispatch(b.doc, 'freeze', { timeStamp: 535 });
  b.advance(10);
  b.dispatch(b.env, 'blur', { timeStamp: 545 });
  assert.deepEqual(recorder.exportTrace().observations.slice(1), [
    { seq: 2, type: 'lifecycle', mono: 510, wall: WALL0 + 10, event: 'visibilitychange', visibilityState: 'hidden', persisted: null, eventTimeStamp: 505 },
    { seq: 3, type: 'lifecycle', mono: 520, wall: WALL0 + 20, event: 'pagehide', visibilityState: 'hidden', persisted: true, eventTimeStamp: 515 },
    { seq: 4, type: 'network', mono: 530, wall: WALL0 + 30, event: 'offline', navigatorOnLine: false, eventTimeStamp: 525 },
    { seq: 5, type: 'lifecycle', mono: 540, wall: WALL0 + 40, event: 'freeze', visibilityState: 'hidden', persisted: null, eventTimeStamp: 535 },
    { seq: 6, type: 'lifecycle', mono: 550, wall: WALL0 + 50, event: 'blur', visibilityState: 'hidden', persisted: null, eventTimeStamp: 545 },
  ]);
});

test('on-time timer ticks are counted without filling the buffer', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, tickIntervalMs: 1000, gapThresholdMs: 3000 });
  recorder.start();
  for (let i = 0; i < 5; i += 1) {
    b.advance(1000);
    b.tick();
  }
  const trace = recorder.exportTrace();
  assert.equal(trace.summary.ticks, 5);
  assert.deepEqual(ofType(trace, 'timer-gap'), []);
});

test('late ticks record monotonic and wall elapsed time separately', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, tickIntervalMs: 1000, gapThresholdMs: 3000 });
  recorder.start();
  b.advance(1000);
  b.tick(); // on time
  b.advance(45_000);
  b.tick(); // both clocks advanced: throttled or suspended timer
  b.advance(1000, 600_000);
  b.tick(); // monotonic clock paused while the wall clock moved 10 minutes
  b.advance(1000, -7000);
  b.tick(); // wall clock stepped backwards
  const gaps = ofType(recorder.exportTrace(), 'timer-gap').map(({ expectedIntervalMs, monoElapsedMs, wallElapsedMs }) => ({
    expectedIntervalMs,
    monoElapsedMs,
    wallElapsedMs,
  }));
  assert.deepEqual(gaps, [
    { expectedIntervalMs: 1000, monoElapsedMs: 45_000, wallElapsedMs: 45_000 },
    { expectedIntervalMs: 1000, monoElapsedMs: 1000, wallElapsedMs: 600_000 },
    { expectedIntervalMs: 1000, monoElapsedMs: 1000, wallElapsedMs: -7000 },
  ]);
  assert.equal(recorder.exportTrace().summary.ticks, 4);
});

test('the timer gap threshold is inclusive on either clock', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, tickIntervalMs: 1000, gapThresholdMs: 3000 });
  recorder.start();
  b.advance(2999);
  b.tick(); // below the threshold on both clocks
  b.advance(3000, 1000);
  b.tick(); // monotonic clock exactly at the threshold
  b.advance(1000, 3000);
  b.tick(); // wall clock exactly at the threshold
  assert.deepEqual(
    ofType(recorder.exportTrace(), 'timer-gap').map((o) => [o.monoElapsedMs, o.wallElapsedMs]),
    [[3000, 1000], [1000, 3000]],
  );
});

test('on a bare runtime the recorder starts, reports unknowns and releases its real timer', () => {
  const before = timeoutHandles();
  const recorder = createRecorder({ tickIntervalMs: 60_000, gapThresholdMs: 120_000 });
  let during;
  let trace;
  try {
    recorder.start();
    during = timeoutHandles();
    trace = recorder.exportTrace();
  } finally {
    recorder.stop(); // a leaked real interval would keep the test process alive
  }
  assert.equal(during, before + 1);
  assert.equal(timeoutHandles(), before);
  assert.equal(trace.environment.source, 'global');
  assert.equal(trace.environment.physicalDeviceVerified, false);
  assert.equal(trace.capabilities.secureContext, 'unknown');
  assert.equal(trace.capabilities.apis.visibilityState, 'unknown');
  assert.equal(trace.capabilities.apis.geolocation, 'not-exposed');
  assert.deepEqual(trace.observations[0].visibilityState, null);
  assert.deepEqual(trace.observations[0].navigatorOnLine, null);
  assert.equal(trace.observations[0].timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test('a missing navigator or document makes capabilities unknown rather than absent', () => {
  const env = {
    performance: { now: () => 1 },
    Date: { now: () => WALL0 },
    setInterval: () => 1,
    clearInterval() {},
  };
  const recorder = createRecorder({ env });
  recorder.start();
  const { capabilities, environment } = recorder.exportTrace();
  assert.deepEqual(capabilities, {
    secureContext: 'unknown',
    apis: {
      geolocation: 'unknown',
      permissions: 'unknown',
      deviceMotionEvent: 'not-exposed',
      deviceMotionRequestPermission: 'not-exposed',
      notification: 'not-exposed',
      serviceWorker: 'unknown',
      pushManager: 'not-exposed',
      wakeLock: 'unknown',
      batteryStatus: 'unknown',
      networkInformation: 'unknown',
      pageFreezeEvent: 'unknown',
      visibilityState: 'unknown',
    },
    permissionsAtStart: { motion: 'unknown', notifications: 'not-exposed' },
  });
  assert.equal(environment.source, 'injected');
  assert.equal(environment.userAgent, null);
});

test('capabilities are read passively and motion or notification permission is never requested', () => {
  const b = fakeBrowser({ permissions: false });
  let motionRequests = 0;
  let notificationRequests = 0;
  b.env.DeviceMotionEvent = class DeviceMotionEvent {};
  b.env.DeviceMotionEvent.requestPermission = async () => {
    motionRequests += 1;
    return 'granted';
  };
  b.env.Notification = {
    permission: 'default',
    requestPermission: async () => {
      notificationRequests += 1;
      return 'granted';
    },
  };
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  const { capabilities } = recorder.exportTrace();
  assert.deepEqual(capabilities, {
    secureContext: true,
    apis: {
      geolocation: 'exposed',
      permissions: 'not-exposed',
      deviceMotionEvent: 'exposed',
      deviceMotionRequestPermission: 'exposed',
      notification: 'exposed',
      serviceWorker: 'not-exposed',
      pushManager: 'not-exposed',
      wakeLock: 'not-exposed',
      batteryStatus: 'not-exposed',
      networkInformation: 'not-exposed',
      pageFreezeEvent: 'not-exposed',
      visibilityState: 'exposed',
    },
    permissionsAtStart: { motion: 'unknown', notifications: 'default' },
  });
  assert.equal(motionRequests, 0);
  assert.equal(notificationRequests, 0);
  assert.equal(b.geo.requests.length + b.geo.watches.size, 0);
});

test('a capability getter that throws is unknown, and a location request through it is recorded', () => {
  const b = fakeBrowser({ permissions: false });
  Object.defineProperty(b.env.navigator, 'geolocation', {
    get() {
      throw new Error('blocked by policy');
    },
  });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.samplePosition();
  const trace = recorder.exportTrace();
  assert.equal(trace.capabilities.apis.geolocation, 'unknown');
  assert.deepEqual(
    ofType(trace, 'geolocation-unavailable').map(({ source, reason, error }) => ({ source, reason, error })),
    [{ source: 'sample', reason: 'threw', error: 'Error' }],
  );
});

test('geolocation permission state is queried passively and later changes are recorded', async () => {
  const b = fakeBrowser();
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  await settle();
  b.status.state = 'denied';
  b.dispatch(b.status, 'change');
  const permissions = ofType(recorder.exportTrace(), 'permission').map(({ name, state, source }) => ({ name, state, source }));
  assert.deepEqual(permissions, [
    { name: 'geolocation', state: 'prompt', source: 'query' },
    { name: 'geolocation', state: 'denied', source: 'change' },
  ]);
  assert.deepEqual(b.queries, ['geolocation']);
  assert.equal(b.geo.requests.length + b.geo.watches.size, 0);
});

test('a rejected permission query is recorded as unknown with the error name', async () => {
  const b = fakeBrowser();
  b.env.navigator.permissions.query = async () => {
    throw new TypeError('geolocation is not a supported permission name');
  };
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  await settle();
  const [permission] = ofType(recorder.exportTrace(), 'permission');
  assert.deepEqual(
    { name: permission.name, state: permission.state, source: permission.source, error: permission.error },
    { name: 'geolocation', state: 'unknown', source: 'query', error: 'TypeError' },
  );
});

test('a permission answer arriving after stop() is ignored and leaves no listener behind', async () => {
  const b = fakeBrowser();
  let answer;
  b.env.navigator.permissions.query = () => new Promise((resolve) => {
    answer = resolve;
  });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.stop();
  answer(b.status);
  await settle();
  b.dispatch(b.status, 'change');
  assert.deepEqual(ofType(recorder.exportTrace(), 'permission'), []);
  assert.equal(b.status.listeners, 0);
});

test('samplePosition() is the only path to a location request and coordinates are omitted by default', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  assert.equal(b.geo.requests.length, 0);
  recorder.samplePosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  assert.deepEqual(b.geo.requests[0].options, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  b.advance(2000);
  b.geo.requests[0].success({
    coords: { latitude: -12.04318, longitude: -77.02824, accuracy: 35, altitude: 3871.25, altitudeAccuracy: 10, heading: null, speed: 0 },
    timestamp: WALL0 - 2000,
  });
  const trace = recorder.exportTrace();
  assert.deepEqual(trace.observations.slice(1), [
    { seq: 2, type: 'geolocation-request', mono: 500, wall: WALL0, source: 'sample', options: { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 } },
    {
      seq: 3,
      type: 'geolocation',
      mono: 2500,
      wall: WALL0 + 2000,
      source: 'sample',
      accuracyM: 35,
      positionTimestamp: WALL0 - 2000,
      ageMs: 4000,
      freshness: 'unknown',
      providedFields: ['altitude', 'altitudeAccuracy', 'speed'],
    },
  ]);
  const json = JSON.stringify(trace);
  for (const leak of ['-12.04318', '-77.02824', '3871.25', 'latitude', 'longitude']) {
    assert.equal(json.includes(leak), false, `export leaked ${leak}`);
  }
  assert.equal(trace.redaction.coordinates, 'omitted');
});

test('raw coordinates are kept only when the tester opts in', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, rawCoordinates: true });
  recorder.start();
  recorder.samplePosition();
  b.geo.requests[0].success({
    coords: { latitude: -12.04318, longitude: -77.02824, accuracy: 35, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    timestamp: WALL0,
  });
  const trace = recorder.exportTrace();
  assert.deepEqual(ofType(trace, 'geolocation')[0].coords, { latitude: -12.04318, longitude: -77.02824, altitude: null });
  assert.equal(trace.redaction.coordinates, 'included-by-tester-choice');
});

test('position age is classified against staleAfterMs, and future or missing timestamps are unknown', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, staleAfterMs: 10_000 });
  recorder.start();
  recorder.watchPosition();
  const [watch] = [...b.geo.watches.values()];
  for (const ageMs of [30_000, 10_000, 9_999, -2000]) watch.success({ coords: { accuracy: 20 }, timestamp: WALL0 - ageMs });
  watch.success({ coords: { accuracy: 20 }, timestamp: Number.NaN });
  assert.deepEqual(
    ofType(recorder.exportTrace(), 'geolocation').map((o) => [o.ageMs, o.freshness]),
    [[30_000, 'stale'], [10_000, 'fresh'], [9_999, 'fresh'], [-2000, 'unknown'], [null, 'unknown']],
  );
});

test('geolocation errors keep the spec code and its name', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  for (let i = 0; i < 4; i += 1) recorder.samplePosition();
  b.geo.requests[0].failure({ code: 1, message: 'User denied Geolocation' });
  b.geo.requests[1].failure({ code: 2, message: 'Position unavailable' });
  b.geo.requests[2].failure({ code: 3, message: 'Timeout expired' });
  b.geo.requests[3].failure({ code: 42 });
  assert.deepEqual(
    ofType(recorder.exportTrace(), 'geolocation-error').map(({ source, code, codeName, message }) => ({ source, code, codeName, message })),
    [
      { source: 'sample', code: 1, codeName: 'PERMISSION_DENIED', message: 'User denied Geolocation' },
      { source: 'sample', code: 2, codeName: 'POSITION_UNAVAILABLE', message: 'Position unavailable' },
      { source: 'sample', code: 3, codeName: 'TIMEOUT', message: 'Timeout expired' },
      { source: 'sample', code: 42, codeName: 'UNKNOWN', message: null },
    ],
  );
});

test('location requests without the API are recorded instead of throwing', () => {
  const b = fakeBrowser({ geolocation: false, permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.samplePosition();
  recorder.watchPosition();
  recorder.watchPosition();
  assert.deepEqual(
    ofType(recorder.exportTrace(), 'geolocation-unavailable').map(({ source, reason, error }) => ({ source, reason, error })),
    [
      { source: 'sample', reason: 'not-exposed', error: null },
      { source: 'watch', reason: 'not-exposed', error: null },
      { source: 'watch', reason: 'not-exposed', error: null },
    ],
  );
});

test('a position watch records each callback until it is cleared', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.watchPosition({ maximumAge: 5000 });
  assert.throws(() => recorder.watchPosition(), /already active/);
  const [[watchId, watch]] = [...b.geo.watches];
  assert.deepEqual(watch.options, { maximumAge: 5000 });
  watch.success({ coords: { accuracy: 12 }, timestamp: WALL0 });
  watch.failure({ code: 2, message: 'kCLErrorLocationUnknown' });
  recorder.clearPositionWatch();
  recorder.clearPositionWatch();
  assert.deepEqual(b.geo.cleared, [watchId]);
  assert.deepEqual(recorder.exportTrace().observations.map((o) => o.type), [
    'start',
    'geolocation-request',
    'geolocation',
    'geolocation-error',
    'geolocation-watch-cleared',
  ]);
});

test('marks and location requests need an active session', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  const calls = [() => recorder.mark('x'), () => recorder.samplePosition(), () => recorder.watchPosition()];
  for (const call of calls) assert.throws(call, /recording session/);
  recorder.start();
  recorder.stop();
  for (const call of calls) assert.throws(call, /recording session/);
  assert.equal(b.geo.requests.length + b.geo.watches.size, 0);
});

test('mark() labels are stored as bounded strings', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.mark('sync-start');
  recorder.mark('x'.repeat(500));
  recorder.mark(7);
  const labels = ofType(recorder.exportTrace(), 'mark').map((o) => o.label);
  assert.deepEqual(labels, ['sync-start', 'x'.repeat(120), '7']);
});

test('the buffer keeps the newest observations and counts what it dropped', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, maxObservations: 3 });
  recorder.start();
  for (const label of ['a', 'b', 'c', 'd']) recorder.mark(label);
  const trace = recorder.exportTrace();
  assert.deepEqual(trace.observations.map((o) => [o.seq, o.label]), [[3, 'b'], [4, 'c'], [5, 'd']]);
  assert.deepEqual(trace.summary, { recorded: 5, retained: 3, dropped: 2, ticks: 0 });
});

test('acquisition settings survive buffer eviction of the request observation', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env, maxObservations: 3 });
  recorder.start();
  recorder.watchPosition({ maximumAge: 123456, timeout: 7890, enableHighAccuracy: true });
  const [[, watch]] = [...b.geo.watches];
  for (let i = 0; i < 4; i += 1) watch.success({ coords: { accuracy: 20 }, timestamp: WALL0 });
  const trace = recorder.exportTrace();
  assert.equal(trace.summary.dropped, 3);
  assert.equal(ofType(trace, 'geolocation-request').length, 0); // evicted from the buffer
  assert.deepEqual(trace.acquisition.geolocation.watch, { enableHighAccuracy: true, maximumAge: 123456, timeout: 7890 });
  assert.equal(trace.acquisition.geolocation.sample, null);
});

test('invalid options are rejected before anything starts', () => {
  const b = fakeBrowser({ permissions: false });
  const invalid = [
    { maxObservations: 0 },
    { maxObservations: 2.5 },
    { tickIntervalMs: -1 },
    { tickIntervalMs: 1000, gapThresholdMs: 1000 },
    { staleAfterMs: -5 },
    { staleAfterMs: Number.POSITIVE_INFINITY },
    { rawCoordinates: 'yes' },
    { sessionLabel: 42 },
  ];
  for (const options of invalid) {
    assert.throws(() => createRecorder({ env: b.env, ...options }), (error) => error instanceof RangeError || error instanceof TypeError, JSON.stringify(options));
  }
  assert.throws(() => createRecorder({ env: {} }), TypeError);
  assert.equal(b.timers.size, 0);
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  assert.throws(() => recorder.samplePosition({ timeout: -1 }), RangeError);
  assert.throws(() => recorder.samplePosition({ maximumAge: Number.POSITIVE_INFINITY }), RangeError);
  assert.equal(b.geo.requests.length, 0);
});

test('exportTrace() returns detached JSON-safe data', () => {
  const b = fakeBrowser({ permissions: false });
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  recorder.mark('x');
  const first = recorder.exportTrace();
  first.observations.length = 0;
  first.summary.recorded = 99;
  const second = recorder.exportTrace();
  assert.equal(second.observations.length, 2);
  assert.equal(second.summary.recorded, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), second);
  assert.equal(second.schema, 'andes.phone-capability.trace/1');
  assert.equal(second.environment.source, 'injected');
  assert.equal(second.environment.physicalDeviceVerified, false);
});

test('stop() removes every listener, timer, watch and permission subscription', async () => {
  const b = fakeBrowser();
  const recorder = createRecorder({ env: b.env });
  recorder.start();
  await settle();
  recorder.watchPosition();
  assert.ok(b.doc.listeners > 0 && b.env.listeners > 0);
  assert.equal(b.status.listeners, 1);
  assert.equal(b.timers.size, 1);
  const [[watchId, watch]] = [...b.geo.watches];
  recorder.stop();
  assert.equal(b.doc.listeners, 0);
  assert.equal(b.env.listeners, 0);
  assert.equal(b.status.listeners, 0);
  assert.equal(b.timers.size, 0);
  assert.deepEqual(b.geo.cleared, [watchId]);
  const recorded = recorder.exportTrace().summary.recorded;
  watch.success({ coords: { accuracy: 5 }, timestamp: WALL0 });
  b.dispatch(b.doc, 'visibilitychange');
  b.dispatch(b.env, 'online');
  b.status.state = 'granted';
  b.dispatch(b.status, 'change');
  const trace = recorder.exportTrace();
  assert.equal(trace.summary.recorded, recorded);
  assert.deepEqual(trace.observations.slice(-2).map((o) => o.type), ['geolocation-watch-cleared', 'stop']);
});
