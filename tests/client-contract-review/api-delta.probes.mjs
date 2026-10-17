// Focused independent controls for the new 78efad0 delta. No application code.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  const root = process.env.ANDES_REVIEW_API_ROOT;
  if (!root) throw new TypeError('An archived API candidate is required');
  const { MemorySession, createApiClient } = await import(pathToFileURL(resolve(root, 'web/src/lib/api/index.ts')).href);
  const session = new MemorySession();
  session.setCredentials({
    issuer: 'https://identity.synthetic.invalid', subject: 'synthetic-user',
    accessToken: 'SYNTHETIC-ONLY', expiresAt: Date.now() + 60_000,
    get privateUnneededField() { throw new Error('credential projection touched an unrelated field'); },
  });
  assert.equal(session.snapshot().status, 'authenticated');
  const trip = 'aabbccdd-abcd-4abc-8abc-abcdefabcdef';
  const grant = 'ffeeddcc-abcd-4abc-8abc-abcdefabcdef';
  const calls = [];
  const api = createApiClient({ baseUrl: 'https://andes.synthetic.invalid', session,
    fetch: async (url, init) => {
      calls.push([url.pathname, init.headers['Idempotency-Key'], init.body]);
      return Response.json({ id: grant, tripId: trip, revoked: true });
    },
  });
  const options = { idempotencyKey: 'synthetic-case-alias-intent' };
  await api.revokeTripContact(trip.toUpperCase(), grant.toUpperCase(), options);
  await api.revokeTripContact(trip, grant, options);
  assert.deepEqual(calls, [
    [`/v1/trips/${trip}/contacts/${grant}/revoke`, options.idempotencyKey, '{}'],
    [`/v1/trips/${trip}/contacts/${grant}/revoke`, options.idempotencyKey, '{}'],
  ]);
  session.clear();
  console.log(JSON.stringify({ passed: true, checks: ['required-credential-fields-only', 'both-path-uuid-aliases-preserve-idempotency-scope'] }));
} catch {
  console.error('Independent API delta probes failed; inspect the archived candidate with synthetic inputs.');
  process.exitCode = 1;
}
