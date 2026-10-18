import assert from 'node:assert/strict';
import test from 'node:test';
import { screens, fixture, ids, currentStatus } from './screen-fixture.mjs';

test('Q1 route_mismatch_blocks_cross_trip_writes; returning to A sends SOS and OK to A', async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  await f.journey.openTrip(ids.draft);
  const view = await mountPhone(f.runtime, 'checkIn', { tripId: ids.other }); t.after(view.unmount);
  if (view.action('sos')) await view.click('sos');
  if (view.action('checkin-ok')) await view.click('checkin-ok');
  assert.deepEqual(f.calls.filter(r => ['sos', 'command'].includes(r.operation)), [], 'mismatch must issue zero writes');
  assert.match(view.text(), /otro viaje/i);
  assert.ok(view.find(n => n.getAttribute?.('href') === `/trips/${ids.draft}/check-in`));
  await view.render('checkIn', { tripId: ids.draft });
  await view.click('sos'); await view.click('checkin-ok');
  assert.deepEqual(f.calls.filter(r => ['sos', 'command'].includes(r.operation)).map(r => [r.operation, r.params.id]),
    [['sos', ids.draft], ['command', ids.draft]]);
});

for (const state of ['not-loaded', 'loading', 'failed', '403', '404', 'invalidated', 'retained-old']) {
  test(`Q2 unknown_status_is_not_no_check: ${state}; matching SOS remains available`, async t => {
    const { mountPhone } = await screens(t), f = fixture(t);
    await f.journey.openTrip(ids.draft);
    const snapshot = f.journey.snapshot.bind(f.journey);
    const status = { state: state === 'loading' ? 'loading' : state === 'not-loaded' ? 'not-loaded' : state === 'invalidated' ? 'available' : 'unavailable',
      data: ['retained-old', 'invalidated'].includes(state) ? currentStatus : null, invalidated: state === 'invalidated',
      clientReceivedAtMs: ['retained-old', 'invalidated'].includes(state) ? Date.parse('2026-10-18T08:00:00Z') : null,
      error: ['403','404'].includes(state) ? { kind: 'rejected', status: Number(state), code: 'denied' } : null };
    f.runtime.journey = { ...f.journey, snapshot: () => ({ ...snapshot(), status }),
      subscribe: listener => f.journey.subscribe(v => listener({ ...v, status })), refreshStatus: async () => ({ kind: 'blocked' }) };
    const view = await mountPhone(f.runtime, 'alerts', { tripId: ids.draft }); t.after(view.unmount);
    assert.doesNotMatch(view.text(), /No hay un control abierto|No hay envíos|Ningún envío|Ningún aviso visible/);
    assert.ok(view.find(n => n.getAttribute?.('data-status-state') === (status.data ? 'stale' : 'unknown')));
    if (status.data) assert.ok(view.find(n => n.tagName === 'TIME' && n.getAttribute?.('dateTime') === '2026-10-18T08:00:00.000Z'));
    await view.click('sos'); assert.equal(f.calls.filter(r => r.operation === 'sos').length, 1);
  });
}
test('Q2 current successful null check and empty deliveries are valid absence', async t => {
  const { mountPhone } = await screens(t), f = fixture(t); await f.journey.openTrip(ids.draft);
  const view = await mountPhone(f.runtime, 'alerts', { tripId: ids.draft }); t.after(view.unmount);
  assert.match(view.text(), /No hay un control abierto/);
  assert.match(view.text(), /Ningún aviso visible/);
  assert.ok(view.find(n => n.getAttribute?.('data-status-state') === 'current'));
});
