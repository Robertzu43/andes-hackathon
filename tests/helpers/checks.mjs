import assert from 'node:assert/strict';

export async function contactFor(f, subject, role) {
  const jwt = await f.token(subject);
  const id = (await f.req('GET', '/v1/me', undefined, jwt)).body.id;
  const invitation = await f.req('POST', '/v1/contacts', {contactId: id, phone: '+5511999990000', map: true, incident: true, ...(role ? {role} : {})});
  assert.equal(invitation.status, 200);
  assert.equal((await f.req('POST', `/v1/contacts/${invitation.body.id}/accept`, {map: true, incident: true}, jwt)).status, 200);
  return {jwt, id, grant: invitation.body.id};
}

export const jobsOf = async (f, incident) => (await f.ctx.pool.query(`SELECT COALESCE(cg.role,'group') AS role,j.channel,j.status,j.unavailable_reason
  FROM jobs j LEFT JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY role,j.channel`, [incident])).rows;
const pending = (role, channel) => ({role, channel, status: 'pending', unavailable_reason: null});
export const expectedFanOut = [pending('colleague', 'sms'), pending('colleague', 'whatsapp'), pending('family', 'sms'), pending('family', 'voice'), pending('family', 'whatsapp'),
  {role: 'group', channel: 'group', status: 'unavailable', unavailable_reason: 'group_support_unverified'}];

const support = ['sms', 'whatsapp', 'voice'].map(channel => ({channel, country: 'BR', locale: 'pt-BR'}));
export const cfg = {silenceMs: 120000, askGraceMs: 60000, arrivalGraceMs: 120000, sweepMs: 5000};
export async function sweep(f, config = cfg) { const {checkOnce} = await import('../../dist/checks/sweep.js'); await checkOnce(f.ctx, support, config); }
export const checksOf = async (f, trip) => (await f.ctx.pool.query('SELECT reason,status,incident_id FROM security_checks WHERE trip_id=$1 ORDER BY created_at,status', [trip])).rows;
export const asking = reason => ({reason, status: 'asking', incident_id: null});
