// Post-trip note: optional, consented, recalled at the next trip registration, and never in the way of trip controls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { screens, fixture, ids, prepare } from './screen-fixture.mjs';

async function check(view, name, checked = true) {
  await view.flush(() => {
    const node = view.action(name);
    const key = Object.keys(node).find(key => key.startsWith('__reactProps$'));
    node[key].onChange({ target: { checked } });
  });
}
async function mount(t, route, setup = () => {}) {
  const { mountPhone } = await screens(t), f = fixture(t); setup(f);
  const view = await mountPhone(f.runtime, route, { tripId: ids.draft }); t.after(view.unmount);
  await view.flush(); await view.flush();
  return { f, view };
}

test('switched off on the server, the summary says nothing is saved and trip registration shows nothing', async t => {
  const summary = await mount(t, 'summary');
  assert.match(summary.view.text(), /no están activadas en este servidor/);
  assert.equal(summary.view.action('note-save'), undefined);
  const registration = await mount(t, 'tripNew');
  assert.doesNotMatch(registration.view.text(), /Nota de tu viaje anterior/);
  assert.deepEqual(registration.f.note.calls, ['read']);
});

test('the summary saves a note only after the driver ticks consent, and says it read it back', async t => {
  const { f, view } = await mount(t, 'summary', f => { f.note.available = true; });
  await view.fill('coaching-text', 'Descansar en Ica antes de las 22 h');
  assert.equal(view.action('note-save').getAttribute('aria-disabled'), 'true');
  await view.submit();
  assert.deepEqual(f.note.calls, ['read'], 'no consent, no save');
  await check(view, 'note-consent'); await view.submit();
  assert.equal(f.note.stored, 'Descansar en Ica antes de las 22 h'); assert.equal(f.note.consent, true);
  assert.match(view.text(), /quedó guardada y la leímos de vuelta/);
  assert.equal(view.find(node => node.tagName === 'BLOCKQUOTE')?.textContent, 'Descansar en Ica antes de las 22 h');
});

test('the next trip registration recalls the note and lets the driver correct and delete it', async t => {
  const { f, view } = await mount(t, 'tripNew', f => { f.note.available = true; f.note.stored = 'Evitar Nazca de noche'; });
  assert.match(view.text(), /Nota de tu viaje anterior/); assert.match(view.text(), /Evitar Nazca de noche/);
  await view.click('note-edit'); await view.fill('coaching-text', 'Evitar Nazca y Palpa de noche');
  await check(view, 'note-consent'); await view.submit();
  assert.equal(f.note.stored, 'Evitar Nazca y Palpa de noche');
  await view.click('note-delete'); await view.flush();
  assert.equal(f.note.stored, null); assert.match(view.text(), /La nota se borró/);
  assert.doesNotMatch(view.text(), /Evitar Nazca/);
});

test('a failing provider is reported as not confirmed, and the trip still confirms', async t => {
  const failed = await mount(t, 'summary', f => { f.note.available = true; f.note.fail = ['save']; });
  await failed.view.fill('coaching-text', 'Nota'); await check(failed.view, 'note-consent'); await failed.view.submit();
  assert.match(failed.view.text(), /No pudimos confirmar que la nota se guardó/);
  assert.doesNotMatch(failed.view.text(), /quedó guardada/);
  const { f, view } = await mount(t, 'tripNew', f => { f.note.fail = ['read']; });
  assert.match(view.text(), /No pudimos consultar tu nota guardada/);
  await prepare(view); await view.submit();
  assert.equal(f.calls.filter(r => r.operation === 'confirmDraft').length, 1);
  assert.equal(f.journey.snapshot().tripId, ids.draft);
});

test('trip controls keep SOS and OK ahead of the new summary link', async t => {
  const { view } = await mount(t, 'checkIn');
  const order = [];
  view.find(node => { const name = node.getAttribute?.('data-action'); if (name) order.push(name); return false; });
  assert.deepEqual(order.filter(name => ['sos', 'checkin-ok', 'open-summary'].includes(name)), ['sos', 'checkin-ok', 'open-summary']);
});
