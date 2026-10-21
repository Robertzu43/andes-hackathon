// One focused DOM fixture using the production controller and gateway, never a second runtime.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { installDom } from './dom-shim.mjs';
import { createDriverJourney } from '../../src/features/driver/controller.mjs';
import { createSessionGateway } from '../../src/lib/api/gateway.ts';
import { MemorySession } from '../../src/lib/api/session.ts';
installDom();
export const ids = Object.fromEntries(['actor', 'truck', 'draft', 'other', 'family', 'familyGrant', 'colleague', 'colleagueGrant', 'incident']
  .map((key, n) => [key, `a0000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`]));
export const fields = { truckId: ids.truck, origin: 'Lima', destination: 'Arequipa', country: 'PE', locale: 'es', timeZone: 'America/Lima' };
export const currentStatus = { trip: { status: 'active', paused: false, expectedArrivalAt: null }, check: null, incident: null, deliveries: [] };
export const contact = (id, contactId, role, status = 'accepted') => ({ id, contactId, role, status,
  map: { requested: true, accepted: status === 'accepted' }, incident: { requested: true, accepted: status === 'accepted' },
  acceptedAt: null, revokedAt: null, revokedBy: null });
export const accepted = () => [contact(ids.familyGrant, ids.family, 'family'), contact(ids.colleagueGrant, ids.colleague, 'colleague')];
export async function screens(t, module = '/tests/phone/home-render.tsx') {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const vite = await createServer({ root, configFile: fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
    envDir: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false } });
  t.after(() => vite.close());
  return vite.ssrLoadModule(module);
}
export function fixture(t) {
  const calls = [], handlers = {};
  let catalog = { readAt: '2026-10-18T09:00:00Z', trucks: [{ id: ids.truck, label: 'Demo' }], contacts: accepted() };
  let reads = 0;
  let savedFields = fields;
  // Post-trip note API: off unless a test switches it on, mirroring the backend default.
  const note = { available: false, stored: null, fail: null, calls: [] };
  const noteCall = (name, value) => { note.calls.push(name); if (note.fail?.includes(name)) return Promise.reject(new Error('fixture provider failure')); return Promise.resolve(value()); };
  const trip = () => ({ id: ids.draft, driver_id: ids.actor, truck_id: ids.truck, ...savedFields, time_zone: 'America/Lima',
    status: 'active', paused: false, map_active: true, checkins_active: true, version: 1 });
  const reply = request => {
    const { operation, params, body } = request;
    if (operation === 'createDraft') { savedFields = body.fields; return { kind: 'ok', data: {
      id: ids.draft, status: 'draft', rawText: body.text, fields: body.fields, missingFields: [] } }; }
    if (operation === 'confirmDraft') return { kind: 'ok', data: { id: params.id, status: 'active', fields: body.fields } };
    if (operation === 'readTrip') return { kind: 'ok', data: trip() };
    if (operation === 'readStatus') return { kind: 'ok', data: currentStatus };
    if (operation === 'sos') return { kind: 'ok', data: { id: ids.incident, tripId: params.id, status: 'active', groupCapability: 'unavailable' } };
    if (operation === 'command') return { kind: 'ok', data: { id: params.id, command: body.type, automaticEscalation: false } };
    throw new Error(`Unhandled ${operation}`);
  };
  const journey = createDriverJourney({ transport: async request => {
    calls.push(structuredClone(request));
    return handlers[request.operation] ? handlers[request.operation](request) : reply(request);
  } });
  journey.setSession(ids.actor); journey.setInteractionMode('stationary'); journey.setNetwork('online');
  const gateway = { getSnapshot: () => ({ state: 'authenticated', mode: 'demo' }), subscribe: () => () => {} };
  const runtime = { journey, gateway, familyGateway: gateway, binding: { activate: async () => {} },
    api: { getBootstrap: async () => { reads++; return structuredClone(catalog); },
      getCoachingNote: () => noteCall('read', () => note.available ? { available: true, note: note.stored && { text: note.stored } } : { available: false }),
      saveCoachingNote: body => noteCall('save', () => { note.stored = body.text; note.consent = body.consent; return { saved: true, note: { text: body.text } }; }),
      deleteCoachingNote: () => noteCall('delete', () => { const deleted = note.stored !== null; note.stored = null; return { deleted }; }) },
    world: { get: async () => ({ world: { family: { id: ids.family }, colleague: { id: ids.colleague } } }) },
    session: {}, familyApi: {}, familySession: {} };
  t.after(() => journey.dispose());
  return { runtime, journey, calls, handlers, reply, trip, note, reads: () => reads,
    catalog: value => { catalog = value; }, getCatalog: () => structuredClone(catalog) };
}
export async function prepare(view) {
  await view.fill('trip-text', 'Carga de demostración');
  await view.fill('trip-origin', 'Lima');
  await view.fill('trip-destination', 'Arequipa');
}
export function realGateway(t) {
  let now = Date.now(), acquisitions = 0, fail = true, release;
  const session = new MemorySession(() => now);
  const gateway = createSessionGateway({ session, mode: 'demo', api: { getIdentity: async () => ({ id: ids.actor }) },
    acquire: async () => { acquisitions++; if (release) await release; if (fail) throw new Error('synthetic acquisition failure');
      return { issuer: 'https://synthetic.test', subject: 'driver', accessToken: 'synthetic', expiresAt: now + 7200000 }; } });
  t.after(() => gateway.dispose());
  return { gateway, session, acquisitions: () => acquisitions, succeed: () => { fail = false; },
    hold: promise => { release = promise; }, expire: () => { now += 7200001; session.snapshot(); } };
}
