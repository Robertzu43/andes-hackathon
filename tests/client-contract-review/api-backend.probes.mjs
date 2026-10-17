// Actual native HTTP/SQL between frozen client and backend; synthetic identities only.
// Reuse lane46's isolated runtime helper instead of implementing another backend.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { CONTRACT, NOW } from './fixtures.mjs';

let owned, app, ctx;
try {
  const apiRoot = process.env.ANDES_REVIEW_API_ROOT;
  const runtimeRoot = process.env.ANDES_REVIEW_RUNTIME_ROOT;
  assert.ok(apiRoot && runtimeRoot && process.env.APP_INTEGRATION_PG_PORT);
  assert.equal(process.env.APP_INTEGRATION_ADMIN_URL, undefined, 'Only an owned cluster is allowed');
  const load = path => import(pathToFileURL(path).href);
  const { MemorySession, createApiClient } = await load(resolve(apiRoot, 'web/src/lib/api/index.ts'));
  const { disposableDatabase } = await load(resolve(runtimeRoot, 'scripts/app-integration/runtime.mjs'));
  const { createContext, migrate } = await load(resolve(runtimeRoot, 'dist/db.js'));
  const { createApp } = await load(resolve(runtimeRoot, 'dist/api/app.js'));
  const requireAtRuntime = createRequire(resolve(runtimeRoot, 'package.json'));
  const { generateKeyPair, SignJWT } = await load(requireAtRuntime.resolve('jose'));
  owned = await disposableDatabase();
  let now = NOW;
  ctx = createContext(owned.url, () => new Date(now));
  await migrate(ctx.pool);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://identity.synthetic.invalid';
  const audience = 'q47-client-contract';
  // Empty channel support: no provider credentials, workers, sends or outbox authority.
  app = createApp({ ctx, auth: { issuer, audience, keyResolver: async () => publicKey } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const wire = [], cases = [];
  const normalize = path => path
    .replace(/(\/v1\/trips\/)[0-9a-f-]+(\/contacts\/)[0-9a-f-]+\/revoke$/i, '$1:id$2:grantId/revoke')
    .replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, ':id');
  async function client(role, phone) {
    const token = await new SignJWT({ phone_number: phone, phone_number_verified: true })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience(audience)
      .setSubject(`synthetic-${role}`).setIssuedAt().setExpirationTime('1h').sign(privateKey);
    const session = new MemorySession();
    session.setCredentials({ issuer, subject: `synthetic-${role}`, accessToken: token, expiresAt: Date.now() + 3_600_000 });
    const api = createApiClient({ baseUrl: origin, session, fetch: async (url, init) => {
      assert.equal(new URL(url).origin, origin, 'Only the owned loopback API may receive a token');
      const response = await fetch(url, init);
      wire.push({ method: init.method, route: normalize(new URL(url).pathname), actor: role,
        ...(init.body === undefined ? {} : { request: JSON.parse(init.body) }),
        status: response.status, response: await response.clone().json() });
      return response;
    } });
    return { api, session };
  }
  const { api: driver } = await client('driver', '+15555550101');
  const { api: contact, session: contactSession } = await client('contact', '+15555550100');
  const { api: stranger } = await client('stranger', '+15555550102');
  const options = key => ({ idempotencyKey: `q47-${key}` });
  async function observe(call, expectedStatus = 200, keyAlias) {
    const index = wire.length;
    let value, failure;
    try { value = await call(); } catch (error) { failure = error; }
    assert.equal(wire.length, index + 1, 'one explicit call must make one HTTP attempt');
    const step = structuredClone(wire[index]);
    assert.equal(step.status, expectedStatus);
    if (expectedStatus === 200) assert.equal(failure, undefined);
    else assert.equal(failure?.status, expectedStatus);
    if (keyAlias) step.keyAlias = keyAlias;
    return { value, step };
  }
  const add = (id, ...records) => cases.push({ id, steps: records.map(record => record.step) });

  const identity = await observe(() => driver.getIdentity());
  const contactId = (await observe(() => contact.getIdentity())).value.id;
  await observe(() => stranger.getIdentity());
  const truck = await observe(() => driver.createTruck({ label: 'SYNTHETIC freight truck' }, options('truck')));
  const invitation = await observe(() => driver.inviteContact({ contactId, phone: '+15555550100', map: true, incident: true }, options('invite')));
  const grant = invitation.value.id;
  const acceptance = await observe(() => contact.acceptContact(grant, { map: true, incident: true }, options('accept')));
  add('setup', identity, truck, invitation, acceptance);
  const fields = { truckId: truck.value.id, origin: 'SYNTHETIC origin', destination: 'SYNTHETIC destination',
    country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };
  const draft = await observe(() => driver.createDraft({ text: 'SYNTHETIC freight trip', fields: { truckId: fields.truckId } }, options('draft')));
  const trip = draft.value.id;
  const confirmation = { confirmed: true, contactGrantIds: [grant], fields };
  const confirmed = await observe(() => driver.confirmTrip(trip, confirmation, options('confirm')), 200, 'confirm-original');
  add('explicit-confirm', draft, confirmed);
  const replay = await observe(() => driver.confirmTrip(trip, confirmation, options('confirm')), 200, 'confirm-original');
  assert.deepEqual(replay.value, confirmed.value);
  const conflict = await observe(() => driver.confirmTrip(trip, confirmation, options('confirm-new')), 409, 'confirm-new');
  add('duplicate-confirm', confirmed, replay, conflict);

  const absent = await observe(() => contact.getSnapshot(trip));
  add('unavailable-snapshot', absent);
  const capturedAt = new Date(now - 10_000).toISOString();
  await observe(() => driver.uploadLocations(trip, [{ capturedAt, latitude: 0, longitude: 0, accuracy: 15 }], options('location')));
  const fresh = await observe(() => contact.getSnapshot(trip));
  now += 300_000;
  const stale = await observe(() => contact.getSnapshot(trip));
  assert.equal(stale.value.location.capturedAt, capturedAt);
  assert.equal(stale.value.ageMs, 310_000);
  add('stale-snapshot', fresh, stale);
  // A recently uploaded older point must not replace the last known source fix.
  await observe(() => driver.uploadLocations(trip, [{ capturedAt: new Date(NOW - 60_000).toISOString(), latitude: 0, longitude: 0, accuracy: 20 }], options('old-location')));
  assert.equal((await observe(() => contact.getSnapshot(trip))).value.location.capturedAt, capturedAt);

  const crossRead = await observe(() => stranger.getTrip(trip), 403);
  const crossSos = await observe(() => stranger.reportSos(trip, options('stranger-sos')), 403);
  add('cross-user', crossRead, crossSos);
  const ok = await observe(() => driver.commandTrip(trip, 'checkin_ok', options('ok')));
  const rest = await observe(() => driver.commandTrip(trip, 'rest_report', options('rest')));
  add('self-report', ok, rest);
  const sos = await observe(() => driver.reportSos(trip, options('sos')));
  const sosAgain = await observe(() => driver.reportSos(trip, options('sos-new-key')));
  add('sos-acceptance', sos, sosAgain);
  const incident = sos.value.id;
  const ack = await observe(() => contact.acknowledgeIncident(incident, options('ack')));
  const action = await observe(() => contact.reportAction(incident, 'SYNTHETIC attributed action', options('action')));
  add('acknowledgement-action', ack, action);

  // Separate trip isolates consent loss while its map and incident were accessible.
  const second = (await observe(() => driver.createDraft({ text: 'SYNTHETIC revoke case', fields }, options('second-draft')))).value.id;
  await observe(() => driver.confirmTrip(second, confirmation, options('second-confirm')));
  await observe(() => contact.getSnapshot(second));
  const secondIncident = (await observe(() => driver.reportSos(second, options('second-sos')))).value.id;
  await observe(() => contact.getIncident(secondIncident));
  const revoked = await observe(() => contact.revokeTripContact(second, grant, options('revoke')));
  const deniedMap = await observe(() => contact.getSnapshot(second), 403);
  const deniedIncident = await observe(() => contact.getIncident(secondIncident), 403);
  add('revocation', revoked, deniedMap, deniedIncident);

  const arrival = await observe(() => driver.commandTrip(trip, 'arrived', options('arrival')));
  const activeIncident = await observe(() => contact.getIncident(incident));
  const closedMap = await observe(() => contact.getSnapshot(trip), 403);
  add('arrival-preserves-sos', sos, arrival, activeIncident, closedMap);
  const notOwner = await observe(() => contact.resolveIncident(incident, options('contact-resolve')), 403);
  const resolved = await observe(() => driver.resolveIncident(incident, options('resolve')));
  add('owner-resolution', notOwner, resolved);
  const countBeforeSignout = wire.length;
  contactSession.clear();
  await assert.rejects(contact.getIdentity(), error => error.kind === 'unauthenticated');
  assert.equal(wire.length, countBeforeSignout);
  assert.equal(cases.length, 12);

  const receipt = { schema: 'andes.app-acceptance.receipt/1', kind: 'isolated-backend-run',
    backendSha: CONTRACT.backend, clientSha: '78efad0a207e98cc44336a03ba6af9fc0c1d2901',
    runtimeSha: 'df05aeb782703e7f1a2ccbb8fd92b509d388c537',
    sourceIdentityVerifiedByRunner: false,
    externalSends: false, isolatedDatabase: true, producer: 'Q47 actual typed-client/native-HTTP/SQL synthetic run',
    command: 'node tests/client-contract-review/api-backend.probes.mjs (frozen roots and owned loopback cluster)', cases };
  if (process.env.ANDES_REVIEW_RECEIPT_PATH) await writeFile(process.env.ANDES_REVIEW_RECEIPT_PATH, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: true, cases: cases.length, httpExchanges: wire.length,
    backendSha: CONTRACT.backend, clientSha: receipt.clientSha, runtimeSha: receipt.runtimeSha,
    sourceIdentityVerifiedByRunner: false,
    limitation: 'Signed-key synthetic identity and owned PostgreSQL/native HTTP only; no browser/OIDC/device/provider or whole-app acceptance.' }));
} catch {
  console.error('Independent client/backend bridge failed (connection, credential and response details redacted).');
  process.exitCode = 1;
} finally {
  try { if (app) await app.close(); else await ctx?.close(); }
  catch { console.error('Owned API cleanup failed.'); process.exitCode = 1; }
  try { await owned?.cleanup(); }
  catch { console.error('Owned PostgreSQL cleanup failed.'); process.exitCode = 1; }
}
