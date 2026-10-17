import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';

export async function contactFor(f, subject, role) {
  const jwt = await f.token(subject);
  const id = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
  const invitation = await f.req('POST', '/v1/contacts', {contactId: id, phone: '+5511999990000', map: true, incident: true, ...(role ? {role} : {})});
  assert.equal(invitation.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, {map: true, incident: true}, jwt)).status, 200);
  return {jwt, id, grant: invitation.body.id};
}

test('drafts keep an optional expected arrival; invitations take a family or colleague role', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family');
  const colleague = await contactFor(f, 'colleague', 'colleague');
  const roles = (await f.ctx.pool.query('SELECT id,role FROM contact_grants ORDER BY role')).rows;
  assert.deepEqual(roles, [{id: colleague.grant, role: 'colleague'}, {id: family.grant, role: 'family'}]);
  const other = await f.token('other');
  const otherId = (await f.req('GET', '/v1/me', undefined, other)).body.id;
  assert.equal((await f.req('POST', '/v1/contacts', {contactId: otherId, phone: '+5511999990000', map: true, incident: true, role: 'boss'})).status, 400);
  const draft = await f.draft({expectedArrivalAt: '2026-10-17T18:00:00Z'});
  assert.equal(draft.status, 200);
  const trip = await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [family.grant]});
  assert.equal(trip.status, 200);
  const row = (await f.ctx.pool.query('SELECT expected_arrival_at,sharing_stopped_at FROM trips WHERE id=$1', [trip.body.id])).rows[0];
  assert.deepEqual(row, {expected_arrival_at: new Date('2026-10-17T18:00:00Z'), sharing_stopped_at: null});
  assert.equal((await f.draft({expectedArrivalAt: 'tomorrow'})).status, 400);
});
