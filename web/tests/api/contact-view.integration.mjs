import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { MemorySession, createApiClient, createSessionGateway } from '../../src/lib/api/index.ts';

// The reviewed UI source stays immutable; only its shared API dependency uses this branch.
const CONTACT_UI = 'e2c1e677cf3ec3fa9c7f91529b082ab5b8ff91e6';
const archive = mkdtempSync(join(tmpdir(), 'andes-api-contact-view-'));
after(() => rmSync(archive, { recursive: true, force: true }));
writeFileSync(join(archive, 'package.json'), '{"type":"module"}\n');
for (const file of ['web/src/features/contacts/view-store.ts', 'web/src/features/contacts/journey.ts',
  'web/src/features/privacy/consent.ts']) {
  const target = join(archive, file); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, execFileSync('git', ['show', `${CONTACT_UI}:${file}`], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
  }));
}
const entry = join(archive, 'web/src/lib/api/index.ts');
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `export * from ${JSON.stringify(new URL('../../src/lib/api/index.ts', import.meta.url).href)};\n`);
const { createContactView } = await import(pathToFileURL(join(archive, 'web/src/features/contacts/view-store.ts')));
const actor = '11111111-1111-4111-8111-111111111111';
const trip = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-17T12:00:00.000Z';
async function until(predicate) {
  for (let count = 0; count < 100; count++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Expected contact view state did not settle');
}

test('reviewed contact UI closes both views after actual-client 401 and permits explicit session recovery', async () => {
  let unauthorized = false;
  const session = new MemorySession();
  const api = createApiClient({ baseUrl: 'https://synthetic.invalid', session, fetch: async url => {
    if (url.pathname === '/v1/me') return Response.json({ id: actor });
    if (url.pathname === '/v1/contacts') return Response.json({ contacts: [], limit: 100, hasMore: false, readAt: stamp });
    if (unauthorized) return Response.json({ code: 'unauthorized' }, { status: 401 });
    return Response.json({ tripId: trip, location: null, freshness: 'unavailable', ageMs: null, readAt: stamp });
  } });
  const gateway = createSessionGateway({ api, session, mode: 'demo', acquire: async () => ({
    issuer: 'synthetic', subject: 'synthetic', accessToken: 'synthetic-token', expiresAt: Date.now() + 60_000,
  }) });
  const host = { api, session, gateway };
  const contact = createContactView(host, 'contact', trip);
  const driver = createContactView(host, 'driver');
  try {
    contact.start(); driver.start(); await gateway.begin();
    await until(() => contact.getSnapshot().journey.location.data && driver.getSnapshot().catalog.data);
    unauthorized = true;
    await contact.loadLocation();
    assert.equal(gateway.getSnapshot().state, 'signed-out');
    assert.equal(session.snapshot().status, 'anonymous');
    for (const view of [contact, driver]) {
      const snapshot = view.getSnapshot();
      assert.equal(snapshot.status, 'closed');
      assert.equal(snapshot.journey.session, null);
      assert.equal(snapshot.journey.location.data, null);
      assert.equal(snapshot.journey.incident.data, null);
      assert.equal(snapshot.catalog.data, null);
    }
    unauthorized = false;
    await gateway.begin();
    await until(() => contact.getSnapshot().journey.location.data && driver.getSnapshot().catalog.data);
    assert.equal(contact.getSnapshot().status, 'ready');
    assert.equal(driver.getSnapshot().status, 'ready');
  } finally { contact.stop(); driver.stop(); gateway.dispose(); }
});
