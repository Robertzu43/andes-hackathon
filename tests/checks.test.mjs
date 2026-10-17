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

export const jobsOf = async (f, incident) => (await f.ctx.pool.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason
  FROM jobs j LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY role,j.channel`, [incident])).rows;
const pending = (role, channel) => ({role, channel, status: 'pending', unavailable_reason: null});
export const expectedFanOut = [pending('colleague', 'sms'), pending('colleague', 'whatsapp'), pending('family', 'sms'), pending('family', 'voice'), pending('family', 'whatsapp'),
  {role: 'group', channel: 'group', status: 'unavailable', unavailable_reason: 'group_support_unverified'}];

test('SOS alerts family on three channels, colleagues on two and records the group as unavailable', async t => {
  const f = await fixture(t);
  const family = await contactFor(f, 'family'); const colleague = await contactFor(f, 'colleague', 'colleague');
  const trip = await f.trip([family.grant, colleague.grant]);
  const sos = await f.req('POST', `/v1/trips/${trip}/sos`, {});
  assert.equal(sos.status, 200);
  assert.deepEqual(await jobsOf(f, sos.body.id), expectedFanOut);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM outbox')).rows[0].n, 5);
  assert.deepEqual((await f.ctx.pool.query('SELECT trigger,check_reason FROM incidents')).rows, [{trigger: 'sos', check_reason: null}]);
});

test('SOS while a check is asking closes it with the SOS incident; SOS upgrades a missed-check incident without new sends', async t => {
  const f = await fixture(t); const family = await contactFor(f, 'family'); const trip = await f.trip([family.grant]);
  await f.ctx.pool.query("INSERT INTO security_checks VALUES(gen_random_uuid(),$1,'silence','asking',$2,$2,$2,NULL,NULL)", [trip, f.ctx.clock()]);
  const sos = (await f.req('POST', `/v1/trips/${trip}/sos`, {})).body.id;
  assert.deepEqual((await f.ctx.pool.query('SELECT status,incident_id FROM security_checks')).rows, [{status: 'escalated', incident_id: sos}]);

  const g = await fixture(t); const other = await contactFor(g, 'family'); const second = await g.trip([other.grant]);
  await g.ctx.pool.query("INSERT INTO incidents(id,trip_id,driver_id,created_at,trigger,check_reason) VALUES(gen_random_uuid(),$1,$2,$3,'missed_check','silence')", [second, g.me.id, g.ctx.clock()]);
  const upgraded = (await g.req('POST', `/v1/trips/${second}/sos`, {})).body.id;
  assert.deepEqual((await g.ctx.pool.query('SELECT id,trigger FROM incidents')).rows, [{id: upgraded, trigger: 'sos'}]);
  assert.equal((await g.ctx.pool.query('SELECT count(*)::int n FROM jobs')).rows[0].n, 0);
});
