import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate, CASES, BACKEND_SHA } from './oracle.mjs';
import { syntheticControl } from './synthetic.mjs';
import { isMain } from './entrypoint.mjs';

const exampleCase = (r, id) => r.cases.find(c => c.id === id);
test('valid synthetic controls pass individual assertions but cannot accept an app', () => {
  const r = evaluate(syntheticControl());
  assert.equal(r.cases.length, CASES.length);
  assert.ok(r.cases.every(c => c.status === 'pass'));
  assert.equal(r.disposition, 'inconclusive'); assert.equal(r.wholeAppAccepted, false);
});
test('a bounded real isolated receipt checks backend facts only, never browser or human qualification', () => {
  const data = syntheticControl(); data.kind = 'isolated-backend-run';
  data.producer = 'TEST ONLY: simulated lane46 receipt';
  const r = evaluate(data);
  assert.equal(r.disposition, 'backend-receipt-checks-pass'); assert.equal(r.wholeAppAccepted, false);
  assert.ok(r.remaining.length > 0);
});
test('absent cases are pending; no response is never counted as success', () => {
  const data = syntheticControl(); data.cases = [];
  const r = evaluate(data); assert.equal(r.disposition, 'inconclusive');
  assert.ok(r.cases.every(c => c.status === 'pending'));
});
test('only the reviewed main backend binding is current; legacy receipts stay rejected', () => {
  assert.equal(BACKEND_SHA, '3a1491a4be1e32a1daa24a72d1afd374760147fd');
  const data = syntheticControl();
  assert.equal(data.backendSha, BACKEND_SHA);
  for (const legacy of ['ebc8fb1d36f441ef012ca585201cefabf61383d6', '5591c9b55fe7f4505e36ccee96d27aa913e0debf']) {
    const old = evaluate({ ...data, backendSha: legacy });
    assert.equal(old.disposition, 'fix');
    assert.ok(old.errors.includes('backend revision differs; rebind and review oracle before reuse'));
    assert.equal(old.wholeAppAccepted, false);
  }
});

const adverse = [
  ['invitation is not contact acceptance', 'setup', c => { c.steps[2].response.status = 'accepted'; }],
  ['scope widening', 'setup', c => { c.steps[2].request.incident = false; c.steps[3].request.incident = true; }],
  ['empty accepted consent', 'setup', c => { c.steps[3].request.map = false; c.steps[3].response.map = false; }],
  ['draft silently activated', 'explicit-confirm', c => { c.steps[0].response.status = 'active'; }],
  ['confirmation without explicit consent', 'explicit-confirm', c => { c.steps[1].request.confirmed = false; }],
  ['invented timezone default', 'explicit-confirm', c => { delete c.steps[1].response.fields.timeZone; }],
  ['implicit country supplied by server', 'explicit-confirm', c => { delete c.steps[0].request.fields.country; }],
  ['confirmation changes entered locale', 'explicit-confirm', c => { c.steps[1].response.fields.locale = 'es-PE'; }],
  ['duplicate creates different trip', 'duplicate-confirm', c => { c.steps[1].response.id = 'another-trip'; }],
  ['new-key conflict control reuses key', 'duplicate-confirm', c => { c.steps[2].keyAlias = 'same-key'; }],
  ['receipt refreshes old source age', 'stale-snapshot', c => { c.steps[1].response.ageMs = 1000; }],
  ['stale shown fresh', 'stale-snapshot', c => { c.steps[1].response.freshness = 'fresh'; }],
  ['missing trip identities in both snapshots', 'stale-snapshot', c => { delete c.steps[0].response.tripId; delete c.steps[1].response.tripId; }],
  ['source clocks omit explicit offset', 'stale-snapshot', c => { c.steps[0].response.location.capturedAt = '2026-10-17T12:00:00.000'; }],
  ['missing location called fresh', 'unavailable-snapshot', c => { c.steps[0].response.freshness = 'fresh'; }],
  ['revoked contact retains map', 'revocation', c => { c.steps[1].status = 200; }],
  ['SOS POST upgraded to delivery', 'sos-acceptance', c => { c.steps[0].response.delivered = true; }],
  ['SOS POST upgraded to provider acceptance', 'sos-acceptance', c => { c.steps[0].response.providerAccepted = true; }],
  ['second SOS response silently resolved', 'sos-acceptance', c => { c.steps[1].response.status = 'resolved'; }],
  ['second SOS response invents group capability', 'sos-acceptance', c => { c.steps[1].response.groupCapability = 'available'; }],
  ['acknowledgement relabelled action', 'acknowledgement-action', c => { c.steps[0].response.recorded = 'action'; }],
  ['arrival resolves SOS', 'arrival-preserves-sos', c => { c.steps[2].response.status = 'resolved'; }],
  ['contact resolves driver incident', 'owner-resolution', c => { c.steps[0].status = 200; }],
  ['cross-user SOS accepted', 'cross-user', c => { c.steps[1].status = 200; }],
  ['report enables automatic escalation', 'self-report', c => { c.steps[0].response.automaticEscalation = true; }],
];
for (const [name, id, corrupt] of adverse) test(`sensitivity control rejects ${name}`, () => {
  const data = syntheticControl(); corrupt(exampleCase(data, id));
  const r = evaluate(data); assert.equal(r.disposition, 'fix');
  assert.equal(r.cases.find(c => c.id === id).status, 'fail');
  assert.equal(r.wholeAppAccepted, false);
});

test('unknown schema, source revision, duplicated/unknown cases, oversized or malformed steps fail closed', () => {
  for (const patch of [r => { r.schema = 'future'; }, r => { r.backendSha = 'unreviewed'; },
    r => { r.externalSends = true; }, r => { r.isolatedDatabase = false; },
    r => { r.cases.push(r.cases[0]); }, r => { r.cases[0].id = 'unregistered'; },
    r => { r.cases[0].steps = null; }, r => { r.cases[0].steps = Array(41).fill({}); }]) {
    const data = syntheticControl(); patch(data); assert.equal(evaluate(data).disposition, 'fix');
  }
  for (const input of [null, [], 1, 'invalid']) assert.equal(evaluate(input).disposition, 'fix');
});
test('CLI returns 2 for synthetic-only evidence, 1 for defect and 0 for backend-only checks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'andes-acceptance-control-'));
  try {
    const path = join(dir, 'receipt.json');
    const run = data => {
      writeFileSync(path, JSON.stringify(data));
      return spawnSync(process.execPath, ['evidence/app-acceptance/check.mjs', path], { encoding: 'utf8' });
    };
    assert.equal(run(syntheticControl()).status, 2);
    const data = syntheticControl(); data.kind = 'isolated-backend-run'; assert.equal(run(data).status, 0);
    data.externalSends = true; assert.equal(run(data).status, 1);
    writeFileSync(path, 'SENSITIVE malformed receipt');
    const invalid = spawnSync(process.execPath, ['evidence/app-acceptance/check.mjs', path], { encoding: 'utf8' });
    assert.equal(invalid.status, 1); assert.equal(invalid.stdout.includes('SENSITIVE'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const script of ['check.mjs', 'synthetic.mjs']) test(`${script} entrypoint works through directory aliases`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'andes-cli-alias-'));
  try {
    const alias = join(dir, 'worktree-alias');
    symlinkSync(process.cwd(), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const receipt = join(dir, 'receipt.json');
    writeFileSync(receipt, JSON.stringify(syntheticControl()));
    const args = [join(alias, 'evidence/app-acceptance', script)];
    if (script === 'check.mjs') args.push(receipt);
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(run.status, script === 'check.mjs' ? 2 : 0);
    assert.ok(run.stdout.trim().length > 0, 'CLI must emit JSON through an alias');
    const json = JSON.parse(run.stdout);
    assert.equal(script === 'check.mjs' ? json.disposition : json.kind,
      script === 'check.mjs' ? 'inconclusive' : 'synthetic-control');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('entrypoint guard tolerates non-file argv during import without claiming main', () => {
  assert.equal(isMain(import.meta.url, ''), false);
  assert.equal(isMain(import.meta.url, '/definitely-absent/andes-entrypoint'), false);
  assert.equal(isMain(import.meta.url, new URL('./check.mjs', import.meta.url)), false);
});
