import { INPUT_FIELDS, COMMANDS, uuid, text, copy, validateFields, inputFields,
  selectionEvidence, acceptedGrantIds, responseData, correlateResponse } from './validation.mjs';

const WRITE_SLOTS = ['truck', 'draft', 'confirm', 'command', 'sos'];
const blocked = (code, details = {}) => ({ kind: 'blocked', code, ...details });
const blankFact = () => ({ state: 'not-loaded', data: null, clientReceivedAtMs: null, invalidated: false, error: null });
const blankForm = () => ({ text: '', fields: Object.fromEntries(INPUT_FIELDS.map((key) => [key, ''])), contactGrantIds: [] });

/** Nonvisual, memory-only controller. Transport and auth are injected. */
export function createDriverJourney({
  transport = null, clock = () => Date.now(), keyFactory = () => globalThis.crypto.randomUUID(),
  timers = globalThis, requestTimeoutMs = 15_000, decodeResponse = null,
} = {}) {
  if (transport !== null && typeof transport !== 'function') throw new TypeError('transport must be a function');
  if (typeof clock !== 'function' || typeof keyFactory !== 'function' ||
      typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function' ||
      !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000 ||
      (decodeResponse !== null && typeof decodeResponse !== 'function')) throw new TypeError('Invalid controller inputs');
  let disposed = false;
  let notifying = false;
  let generation = 0;
  let auth = { state: 'unknown', actorId: null };
  let interaction = 'unknown';
  let network = 'unknown';
  let form = blankForm();
  let selection = null;
  let draft = null;
  let activation = null;
  let tripId = null;
  let openingTripId = null;
  let trip = blankFact();
  let location = blankFact();
  let incident = blankFact();
  let status = blankFact();
  const writes = new Map();
  const reads = new Map();
  const listeners = new Set();
  const now = () => { try { const value = clock(); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const unresolved = (slot) => ['pending', 'unknown'].includes(writes.get(slot)?.state);
  const lockedForm = () => tripId !== null || openingTripId !== null || unresolved('draft') || unresolved('confirm') || activation !== null;
  const operationState = (run) => ({ state: run.state, request: copy(run.request), result: copy(run.result),
    clientReceivedAtMs: run.clientReceivedAtMs, sourceTime: null });

  function snapshot() {
    const facts = copy({ trip, location, incident, status, activation });
    return copy({ disposed, auth, interaction, network, form, selection, draft, activation,
      tripId, ...facts, operations: Object.fromEntries([...writes].map(([slot, run]) => [slot, operationState(run)])) });
  }

  function notify() {
    if (notifying) return;
    notifying = true;
    try {
      const freeze = (value) => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
        return value;
      };
      const view = freeze(snapshot());
      for (const listener of [...listeners]) { try { listener(view); } catch { /* Local view errors do not change server facts. */ } }
    }
    finally { notifying = false; }
  }

  function editable() {
    if (disposed) return blocked('disposed');
    if (notifying) return blocked('view-reentrancy');
    return null;
  }

  function interactionGate() {
    const problem = editable(); if (problem) return problem;
    if (auth.state !== 'authenticated') return blocked('authentication-required');
    if (!['stationary', 'allowed-assistance'].includes(interaction)) return blocked('interaction-not-allowed');
    return null;
  }

  function writeGate({ emergency = false } = {}) {
    const problem = emergency ? editable() : interactionGate(); if (problem) return problem;
    if (auth.state !== 'authenticated') return blocked('authentication-required');
    if (network === 'offline') return blocked('offline');
    if (!transport) return blocked('transport-unavailable');
    return null;
  }

  function normalizeResult(result, request, actorId, write) {
    if (result?.kind === 'ok') {
      let data;
      try {
        data = decodeResponse ? correlateResponse(request, decodeResponse(request, result.data), actorId) :
          responseData(request, result.data, actorId);
      } catch { return { kind: 'unknown', code: 'invalid-response' }; }
      if (request.operation === 'readIncident' && data?.tripId !== tripId) return { kind: 'unknown', code: 'trip-mismatch' };
      return data ? { kind: 'ok', data } : { kind: 'unknown', code: 'invalid-response' };
    }
    if (result?.kind === 'not_sent') return { kind: 'not_sent', code:
      typeof result.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(result.code) ? result.code : 'not-sent' };
    if (result?.kind === 'rejected' && Number.isInteger(result.status) && result.status >= 400 && result.status < 500) {
      return { kind: 'rejected', status: result.status,
        code: typeof result.code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(result.code) ? result.code : 'request-rejected' };
    }
    // 5xx, abort, missing/malformed response and network failure cannot disprove a committed write.
    return { kind: 'unknown', code: write ? 'submission-unknown' : 'read-unavailable' };
  }

  function runRequest(slot, request, apply, { write = true, priorUnknown = false } = {}) {
    const store = write ? writes : reads;
    if (!write) store.get(slot)?.cancel('superseded');
    const epoch = generation;
    const actorId = auth.actorId;
    const abort = new AbortController();
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const run = { state: 'pending', request: copy(request), result: null, clientReceivedAtMs: null, promise, timer: null, cancel: null };
    store.set(slot, run);
    const current = () => !disposed && generation === epoch && store.get(slot) === run && run.state === 'pending';
    function finish(result, { quiet = false } = {}) {
      if (run.state !== 'pending') return;
      // These responses run inside confirmation's idempotent operation, after
      // successful receipts are replayed. They prove this same intent did not commit.
      const disprovedConfirmation = request.operation === 'confirmDraft' && result.kind === 'rejected' &&
        ((result.status === 409 && ['draft_incomplete', 'contact_not_accepted'].includes(result.code)) ||
          (result.status === 403 && result.code === 'truck_not_owned'));
      if (priorUnknown && (result.kind === 'not_sent' || (result.kind === 'rejected' && !disprovedConfirmation))) {
        // A retry's rejection cannot disprove an earlier ambiguous commit.
        result = { kind: 'unknown', code: 'prior-submission-unresolved', status: result.status, responseCode: result.code };
      }
      run.state = result.kind === 'ok' ? 'accepted' : ['rejected', 'not_sent'].includes(result.kind) ? result.kind : 'unknown';
      run.result = copy(result);
      const receivedAt = now();
      if (result.kind !== 'unknown') run.clientReceivedAtMs = receivedAt;
      timers.clearTimeout(run.timer); run.timer = null;
      if (result.kind === 'unknown') abort.abort();
      if (!quiet && !disposed && generation === epoch && store.get(slot) === run) {
        if (result.kind === 'ok') apply(copy(result.data), receivedAt);
        if (!write && result.kind !== 'ok') {
          const fact = slot === 'trip' ? trip : slot === 'location' ? location : slot === 'status' ? status : incident;
          fact.state = 'unavailable'; fact.error = copy(result);
          if ([401, 403, 404].includes(result.status)) fact.data = null;
        }
        if (result.status === 401) {
          auth.state = 'expired'; selection = null;
          trip = blankFact(); location = blankFact(); incident = blankFact(); status = blankFact();
          for (const other of [...writes.values(), ...reads.values()]) if (other !== run) other.cancel('authentication-expired');
        }
        notify();
      }
      resolve(copy(result));
    }
    run.cancel = (code) => finish({ kind: 'unknown', code }, { quiet: true });
    run.timer = timers.setTimeout(() => {
      if (current()) finish({ kind: 'unknown', code: write ? 'submission-timeout-unknown' : 'read-timeout' });
    }, requestTimeoutMs);
    notify();
    Promise.resolve().then(async () => {
      if (!current()) return;
      try {
        const result = await transport(copy(run.request), { signal: abort.signal });
        if (current()) {
          // A received acknowledgement is evidence even after suspend or a wall
          // clock correction. Only an actually fired timeout retires this wait.
          finish(normalizeResult(result, run.request, actorId, write));
        }
      } catch { if (current()) finish({ kind: 'unknown', code: write ? 'submission-unknown' : 'read-unavailable' }); }
    });
    return promise;
  }

  function write(slot, descriptor, apply, { newIntent = false } = {}) {
    const previous = writes.get(slot);
    if (previous?.state === 'pending') {
      const previousDescriptor = { ...previous.request, idempotencyKey: undefined };
      return JSON.stringify(previousDescriptor) === JSON.stringify(descriptor) ? previous.promise : Promise.resolve(blocked('operation-in-progress'));
    }
    const problem = writeGate({ emergency: slot === 'sos' }); if (problem) return Promise.resolve(problem);
    if (previous?.state === 'unknown') {
      if (slot !== 'sos') return Promise.resolve(blocked('unresolved-submission'));
      return runRequest(slot, copy(previous.request), apply, { priorUnknown: true });
    }
    if (previous?.state === 'accepted' && !newIntent &&
        JSON.stringify({ ...previous.request, idempotencyKey: undefined }) === JSON.stringify(descriptor)) {
      return Promise.resolve(copy(previous.result));
    }
    let key;
    try { key = keyFactory(); } catch { return Promise.resolve(blocked('idempotency-unavailable')); }
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) return Promise.resolve(blocked('idempotency-unavailable'));
    return runRequest(slot, { ...copy(descriptor), idempotencyKey: key }, apply);
  }

  function applyWrite(slot, request, data, receivedAt) {
    if (slot === 'truck') {
      if (selection && selection.trucks.every((truck) => truck.id !== data.id)) {
        selection.trucks.push({ id: data.id, label: request.body.label });
      }
    } else if (slot === 'draft') { draft = data; }
    else if (slot === 'confirm') {
      activation = { data, clientReceivedAtMs: receivedAt, source: 'confirm-response', sourceTime: null, invalidated: false };
      tripId = data.id; trip = blankFact(); location = blankFact(); incident = blankFact(); status = blankFact();
    } else if (slot === 'command') {
      // A command acknowledgement is not a refreshed trip state or a wellbeing outcome.
      trip.invalidated = true; location.invalidated = true; status.invalidated = true;
      if (activation) activation.invalidated = true;
      if (['arrived', 'cancel'].includes(request.body.type)) activation = null;
    } else if (slot === 'sos') {
      incident = { state: 'available', data, clientReceivedAtMs: receivedAt, invalidated: false, error: null };
    }
  }

  function submit(slot, descriptor, options) {
    return write(slot, descriptor, (data, at) => applyWrite(slot, descriptor, data, at), options);
  }

  function setSession(actorId = null) {
    const problem = editable(); if (problem) return problem;
    if (actorId !== null && !uuid(actorId)) return blocked('invalid-actor');
    if (actorId !== null && auth.state === 'authenticated' && auth.actorId === actorId.toLowerCase()) return { kind: 'local-state' };
    generation += 1;
    for (const run of [...writes.values(), ...reads.values()]) run.cancel('session-ended');
    writes.clear(); reads.clear(); selection = null; form = blankForm(); draft = null; activation = null;
    tripId = null; openingTripId = null; trip = blankFact(); location = blankFact(); incident = blankFact(); status = blankFact();
    interaction = 'unknown';
    auth = { state: actorId ? 'authenticated' : 'unknown', actorId: actorId?.toLowerCase() ?? null };
    notify(); return { kind: 'local-state' };
  }

  function setInteractionMode(value) {
    const problem = editable(); if (problem) return problem;
    if (!['unknown', 'moving', 'stationary', 'allowed-assistance'].includes(value)) return blocked('invalid-interaction');
    interaction = value; notify(); return { kind: 'local-state' };
  }

  function setNetwork(value) {
    const problem = editable(); if (problem) return problem;
    if (!['unknown', 'online', 'offline'].includes(value)) return blocked('invalid-network');
    network = value; notify(); return { kind: 'local-state' };
  }

  function provideSelectionEvidence(value) {
    const problem = editable(); if (problem) return problem;
    if (auth.state !== 'authenticated') return blocked('authentication-required');
    const parsed = selectionEvidence(value, auth.actorId);
    if (!parsed) return blocked('invalid-selection-evidence');
    selection = parsed; notify(); return { kind: 'local-state' };
  }

  function editForm(patch) {
    const problem = interactionGate(); if (problem) return problem;
    if (lockedForm()) return blocked('form-locked');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
        Object.keys(patch).some((key) => !['text', 'fields'].includes(key))) return blocked('invalid-form-patch');
    if (patch.text !== undefined && (draft || typeof patch.text !== 'string' || patch.text.length > 10000)) return blocked('text-immutable-or-invalid');
    if (patch.fields !== undefined && (!patch.fields || typeof patch.fields !== 'object' || Array.isArray(patch.fields) ||
        Object.entries(patch.fields).some(([key, value]) => !INPUT_FIELDS.includes(key) || typeof value !== 'string' || value.length > 300))) return blocked('invalid-fields');
    if (patch.text !== undefined) form.text = patch.text;
    if (patch.fields) Object.assign(form.fields, copy(patch.fields));
    notify(); return { kind: 'local-state' };
  }

  function selectContacts(ids) {
    const problem = interactionGate(); if (problem) return problem;
    if (lockedForm()) return blocked('form-locked');
    const normalized = acceptedGrantIds(ids, selection);
    if (!normalized) return blocked('contacts-not-accepted');
    form.contactGrantIds = normalized; notify(); return { kind: 'local-state' };
  }

  function registerTruck(label) {
    const problem = writeGate(); if (problem) return Promise.resolve(problem);
    if (!selection) return Promise.resolve(blocked('ownership-read-required'));
    if (selection.trucks.length >= 2) return Promise.resolve(blocked('two-truck-scope'));
    if (!text(label)) return Promise.resolve(blocked('invalid-truck-label'));
    return submit('truck', { operation: 'createTruck', params: {}, body: { label } });
  }

  function saveDraft() {
    const problem = writeGate(); if (problem) return Promise.resolve(problem);
    if (tripId) return Promise.resolve(blocked('journey-already-bound'));
    if (draft) return Promise.resolve(blocked('draft-already-saved'));
    if (!text(form.text, 10000)) return Promise.resolve(blocked('text-required'));
    const errors = validateFields(form.fields);
    if (Object.keys(errors).length) return Promise.resolve(blocked('invalid-fields', { errors }));
    const fields = inputFields(form.fields);
    if (fields.truckId && !selection?.trucks.some((truck) => truck.id === fields.truckId)) return Promise.resolve(blocked('truck-not-owned'));
    return submit('draft', { operation: 'createDraft', params: {}, body: { text: form.text, fields } });
  }

  function confirmTrip({ confirmed = false } = {}) {
    const problem = writeGate(); if (problem) return Promise.resolve(problem);
    if (confirmed !== true) return Promise.resolve(blocked('explicit-confirm-required'));
    if (activation) return Promise.resolve(copy(writes.get('confirm').result));
    if (tripId) return Promise.resolve(blocked('journey-already-bound'));
    if (!draft) return Promise.resolve(blocked('draft-required'));
    const errors = validateFields(form.fields, { complete: true });
    if (Object.keys(errors).length) return Promise.resolve(blocked('incomplete-or-invalid-fields', { errors }));
    const fields = inputFields(form.fields);
    if (!selection?.trucks.some((truck) => truck.id === fields.truckId)) return Promise.resolve(blocked('truck-not-owned'));
    const grants = acceptedGrantIds(form.contactGrantIds, selection);
    if (!grants) return Promise.resolve(blocked('contacts-not-accepted'));
    return submit('confirm', { operation: 'confirmDraft', params: { id: draft.id },
      body: { confirmed: true, contactGrantIds: grants, fields } });
  }

  function sendCommand(type, { newIntent = false } = {}) {
    const problem = writeGate(); if (problem) return Promise.resolve(problem);
    if (!tripId) return Promise.resolve(blocked('trip-required'));
    if (!COMMANDS.includes(type)) return Promise.resolve(blocked('unsupported-command'));
    if (trip.data && trip.data.status !== 'active') return Promise.resolve(blocked('trip-closed'));
    return submit('command', { operation: 'command', params: { id: tripId }, body: { type } },
      { newIntent: newIntent === true || ['checkin_ok', 'rest_report'].includes(type) });
  }

  function requestHelp() {
    const problem = writeGate({ emergency: true }); if (problem) return Promise.resolve(problem);
    if (!tripId && draft && unresolved('confirm')) return reconcileThenHelp();
    if (!tripId) return Promise.resolve(blocked('trip-required'));
    return submit('sos', { operation: 'sos', params: { id: tripId }, body: {} }, { newIntent: true });
  }

  // R8: a confirmation in flight or with a lost response may have committed, and
  // the trip ID is the draft ID. Settle it, read that trip, then send the SOS.
  async function reconcileThenHelp() {
    await writes.get('confirm').promise;
    if (!tripId && draft && writes.get('confirm')?.state === 'unknown') {
      const read = await openTrip(draft.id);
      // Only a read that proves there is no trip of ours ends in trip-required.
      if (!tripId) return read.kind === 'rejected' && [403, 404].includes(read.status) ? blocked('trip-required') : read;
    }
    return requestHelp();
  }

  function retryUnknown(slot, { confirmed = false } = {}) {
    const problem = writeGate({ emergency: slot === 'sos' }); if (problem) return Promise.resolve(problem);
    const run = writes.get(slot);
    if (!WRITE_SLOTS.includes(slot) || run?.state !== 'unknown') return Promise.resolve(blocked('unknown-submission-required'));
    if (confirmed !== true) return Promise.resolve(blocked('explicit-retry-required'));
    const descriptor = copy(run.request);
    return runRequest(slot, descriptor, (data, at) => applyWrite(slot, descriptor, data, at), { priorUnknown: true });
  }

  function read(slot, descriptor) {
    const problem = editable(); if (problem) return Promise.resolve(problem);
    if (auth.state !== 'authenticated') return Promise.resolve(blocked('authentication-required'));
    if (!transport) return Promise.resolve(blocked('transport-unavailable'));
    if (network === 'offline') return Promise.resolve(blocked('offline'));
    const fact = slot === 'trip' ? trip : slot === 'location' ? location : slot === 'status' ? status : incident;
    fact.state = 'loading'; fact.error = null;
    return runRequest(slot, descriptor, (data, at) => {
      if (slot === 'incident' && data.tripId !== tripId) { incident = { ...blankFact(), state: 'unavailable', error: { code: 'trip-mismatch' } }; return; }
      const next = { state: 'available', data, clientReceivedAtMs: at, invalidated: false, error: null };
      if (slot === 'trip') { trip = next; tripId = data.id; if (data.status !== 'active') activation = null; }
      else if (slot === 'location') location = next;
      else if (slot === 'status') {
        status = next;
        if (data.incident) incident = { ...next, data: { ...data.incident, tripId } };
      }
      else incident = next;
    }, { write: false });
  }

  function openTrip(id) {
    const problem = editable(); if (problem) return Promise.resolve(problem);
    if (!uuid(id)) return Promise.resolve(blocked('invalid-trip'));
    const normalized = id.toLowerCase();
    if (tripId && tripId !== normalized) return Promise.resolve(blocked('journey-already-bound'));
    if (openingTripId && openingTripId !== normalized) return Promise.resolve(blocked('journey-already-bound'));
    const reconciling = writes.get('confirm')?.state === 'unknown' && draft?.id === normalized;
    if (unresolved('confirm') && !reconciling) return Promise.resolve(blocked('unresolved-submission'));
    if (!tripId && (draft || unresolved('draft')) && !reconciling) return Promise.resolve(blocked('journey-already-bound'));
    openingTripId = normalized;
    const pending = read('trip', { operation: 'readTrip', params: { id: normalized } });
    // A previous read must not release a newer read's form lock.
    const run = reads.get('trip');
    return pending.finally(() => { if (reads.get('trip') === run) openingTripId = null; });
  }

  function refreshLocation() {
    if (!tripId) return Promise.resolve(blocked('trip-required'));
    return read('location', { operation: 'readSnapshot', params: { id: tripId } });
  }

  function refreshStatus() {
    if (!tripId) return Promise.resolve(blocked('trip-required'));
    return read('status', { operation: 'readStatus', params: { id: tripId } });
  }

  function refreshIncident(id = incident.data?.id) {
    if (!tripId || !uuid(id)) return Promise.resolve(blocked('incident-required'));
    return read('incident', { operation: 'readIncident', params: { id: id.toLowerCase() } });
  }

  function dispose() {
    if (disposed) return;
    disposed = true; generation += 1;
    for (const run of [...writes.values(), ...reads.values()]) run.cancel('disposed');
    writes.clear(); reads.clear(); listeners.clear(); selection = null; form = blankForm(); draft = null;
    activation = null; tripId = null; openingTripId = null; trip = blankFact(); location = blankFact(); incident = blankFact(); status = blankFact();
    auth = { state: 'unknown', actorId: null };
  }

  return { snapshot, setSession, setInteractionMode, setNetwork, provideSelectionEvidence,
    editForm, selectContacts, registerTruck, saveDraft, confirmTrip, sendCommand, requestHelp, retryUnknown,
    openTrip, refreshLocation, refreshStatus, refreshIncident, dispose,
    subscribe(listener) {
      if (disposed || typeof listener !== 'function' || listeners.size >= 16) throw new TypeError('Invalid or excessive view subscription');
      listeners.add(listener); return () => listeners.delete(listener);
    },
  };
}
