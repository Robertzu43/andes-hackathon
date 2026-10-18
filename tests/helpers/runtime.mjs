import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import assert from 'node:assert/strict';

export async function fixture(t, options = {}) {
  assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required (use a disposable PostgreSQL database)');
  const { createApp } = await import('../../dist/api/app.js').catch(() => ({}));
  assert.equal(typeof createApp, 'function', 'missing executable API foundation');
  const { createContext, migrate } = await import('../../dist/db.js');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  url.searchParams.set('application_name', schema); // lets lock barriers watch only this test's connections
  let now = new Date('2026-10-17T12:00:00Z');
  const ctx = createContext(url.toString(), () => now);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  await migrate(ctx.pool);
  const app = createApp({ ctx, auth: { issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => publicKey },
    channelSupport: ['sms', 'whatsapp', 'voice'].map(channel => ({ channel, country: 'BR', locale: 'pt-BR' })), ...options });
  await app.ready();
  t.after(async () => { await app.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  const phones = { driver: '+15555550101', stranger: '+15555550102', contact: '+15555550100' };
  function phoneFor(subject) {
    phones[subject] ??= `+1555555${String(100 + Object.keys(phones).length).padStart(4, '0')}`;
    return phones[subject];
  }
  async function token(subject, claims = {}) {
    return new SignJWT({ phone_number: phoneFor(subject), phone_number_verified: true, sub: subject, iss: 'https://synthetic.test', aud: 'andes-test', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
  }
  const driver = await token('driver'); const stranger = await token('stranger'); const contact = await token('contact');
  async function req(method, url, body, jwt = driver, key = randomUUID()) {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${jwt}`, 'idempotency-key': key }, payload: body });
    return { status: response.statusCode, body: response.json() };
  }
  const me = await req('GET', '/v1/me');
  const other = await req('GET', '/v1/me', undefined, contact);
  async function truck(jwt = driver) { return (await req('POST', '/v1/trucks', { label: 'SYNTHETIC truck' }, jwt)).body.id; }
  async function draft(fields = {}, jwt = driver) {
    return req('POST', '/v1/trip-drafts', { text: 'SYNTHETIC freight trip', fields: { truckId: await truck(jwt), origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo', ...fields } }, jwt);
  }
  async function grant(accept = true) {
    const invitation = await req('POST', '/v1/contacts', { contactId: other.body.id, phone: phones.contact, map: true, incident: true });
    assert.equal(invitation.status, 200);
    if (accept) assert.equal((await req('POST', `/v1/contacts/${invitation.body.id}/accept`, { map: true, incident: true }, contact)).status, 200);
    return invitation.body.id;
  }
  async function trip(grants = []) {
    const d = await draft(); assert.equal(d.status, 200);
    const result = await req('POST', `/v1/trip-drafts/${d.body.id}/confirm`, { confirmed: true, contactGrantIds: grants });
    assert.equal(result.status, 200); return result.body.id;
  }
  return { app, ctx, req, token, phoneFor, driver, stranger, contact, me: me.body, contactIdentity: other.body, truck, draft, grant, trip, advance(ms) { now = new Date(now.getTime() + ms); } };
}
