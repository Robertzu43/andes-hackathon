import assert from 'node:assert/strict';
import test from 'node:test';
import { screens, fixture, ids, contact, accepted, prepare } from './screen-fixture.mjs';
for (const kind of ['missing', 'pending', 'revoked', 'foreign']) test(`Q3 family_acceptance_required: ${kind} sends zero confirms`, async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  const contacts = kind === 'missing' ? [accepted()[1]] : [contact(ids.familyGrant, kind === 'foreign' ? ids.other : ids.family, 'family', kind === 'pending' ? 'pending' : kind === 'revoked' ? 'revoked' : 'accepted'), accepted()[1]];
  f.catalog({ ...f.getCatalog(), contacts });
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount);
  await prepare(view); await view.submit();
  assert.equal(f.calls.filter(r => r.operation === 'confirmDraft').length, 0);
  assert.match(view.text(), /aceptación|acepte/);
});
test('Q3 accepted same-world contactId keeps family and colleague; catalog is re-read at confirm', async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view); await view.submit();
  const confirms = f.calls.filter(r => r.operation === 'confirmDraft');
  assert.equal(confirms.length, 1); assert.deepEqual(confirms[0].body.contactGrantIds, [ids.familyGrant, ids.colleagueGrant]);
  assert.ok(f.reads() >= 2, 'consent must be re-read at confirmation');
});
test('Q3 consent revoked after preparation prevents confirmation', async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view);
  f.catalog({ ...f.getCatalog(), contacts: [contact(ids.familyGrant, ids.family, 'family', 'revoked')] }); await view.submit();
  assert.equal(f.calls.filter(r => r.operation === 'confirmDraft').length, 0);
});
test('Q3 backend 409 contact_not_accepted shows consent recovery and stays inactive', async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  f.handlers.confirmDraft = () => ({ kind: 'rejected', status: 409, code: 'contact_not_accepted' });
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view); await view.submit();
  assert.equal(f.journey.snapshot().tripId, null); assert.match(view.text(), /aceptación|acepte/);
});
for (const kind of ['rejected', 'not_sent']) test(`Q4 saved_draft_confirmation_recovers: ${kind} confirms the saved draft explicitly`, async t => {
  const { mountPhone } = await screens(t), f = fixture(t);
  f.handlers.confirmDraft = () => kind === 'rejected' ? { kind, status: 409, code: 'draft_incomplete' } : { kind, code: 'offline' };
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view); await view.submit();
  assert.equal(f.journey.snapshot().draft.id, ids.draft);
  if (kind === 'not_sent') assert.match(view.text(), /no se envió/);
  assert.ok(view.action('retry-confirm'), 'saved draft must expose explicit confirmation recovery');
  delete f.handlers.confirmDraft; await view.click('retry-confirm');
  assert.equal(f.journey.snapshot().tripId, ids.draft);
  assert.equal(f.calls.filter(r => r.operation === 'createDraft').length, 1);
  assert.equal(f.calls.filter(r => r.operation === 'confirmDraft').length, 2);
});
test('Q4 unknown confirmation retries identical id/body/key without re-saving', async t => {
  const { mountPhone } = await screens(t), f = fixture(t); f.handlers.confirmDraft = () => ({ kind: 'unknown' });
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view); await view.submit();
  assert.ok(view.action('reconcile-confirm')); assert.ok(view.action('retry-unknown-confirm'));
  assert.equal(view.action('confirm-trip'), undefined);
  delete f.handlers.confirmDraft; await view.click('retry-unknown-confirm');
  const calls = f.calls.filter(r => r.operation === 'confirmDraft'); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(f.calls.filter(r => r.operation === 'createDraft').length, 1); assert.equal(f.journey.snapshot().tripId, ids.draft);
});
test('Q4 unknown confirmation reconciles authoritative existing trip by saved id', async t => {
  const { mountPhone } = await screens(t), f = fixture(t); f.handlers.confirmDraft = () => ({ kind: 'unknown' });
  const view = await mountPhone(f.runtime, 'tripNew'); t.after(view.unmount); await prepare(view); await view.submit();
  assert.ok(view.action('reconcile-confirm')); await view.click('reconcile-confirm');
  assert.equal(f.journey.snapshot().tripId, ids.draft);
  assert.deepEqual(f.calls.filter(r => r.operation === 'readTrip').map(r => r.params.id), [ids.draft]);
  assert.equal(f.calls.filter(r => r.operation === 'confirmDraft').length, 1);
  assert.equal(f.calls.filter(r => r.operation === 'createDraft').length, 1);
});
