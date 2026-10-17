// Read-only exact-commit dependency inventory. No app, DB, install or credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const cwd = resolve(process.argv[2] ?? new URL('../../../', import.meta.url).pathname);
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const pins = [
  ['foundation-handoff', '3283fe675ebeee04bb2be8a62f42ab5c475b4b0e'],
  ['foundation-current-PR56', '6f8dc52a566d3880cf1f10bbfd5282a888725ca1'],
  ['driver-current-PR63', '80e9d45f9a234de54b1017e856e8349c097b8760'],
  ['contact-current-PR62', '21cd50ac15c22a2a3cc71bf105336e8ebc77c285'],
  ['client-handoff', git('rev-parse', '292d3c4').trim()],
  ['client-current-PR59', '7e241c39a31d4eaba5f8028fd977e06f6ca72d4d'],
];
const candidates = pins.map(([name, sha]) => {
  const files = git('ls-tree', '-r', '--name-only', sha).trim().split('\n');
  const codeFiles = files.filter(f => /\.(?:[cm]?js|jsx|tsx?|mts|cts|json|html)$/.test(f) && /^(?:src|web\/src|web\/tests|tests)\//.test(f));
  const references = [];
  for (const file of codeFiles) {
    const source = git('show', `${sha}:${file}`);
    source.split('\n').forEach((line, index) => {
      if (/monitoring-state|projectMonitoringState|PROJECTION_VERSION/.test(line)) references.push({ file, line: index + 1, text: line });
    });
  }
  const moduleFiles = files.filter(f => /^src\/monitoring-state\//.test(f));
  assert.deepEqual(moduleFiles, [], `${name} unexpectedly contains the retired module`);
  assert.deepEqual(references, [], `${name} references the retired module`);
  const tree = git('rev-parse', `${sha}^{tree}`).trim();
  return { name, sha, tree, codeFilesScanned: codeFiles.length, moduleFiles, references,
    inventorySha256: createHash('sha256').update(files.join('\n')).digest('hex') };
});
const backend = 'c752de8a3b424bcbc086764dc11052348b27e320';
const routes = git('show', `${backend}:src/location/routes.ts`);
assert.ok(routes.includes("app.get('/v1/trips/:id/snapshot'"));
for (const field of ['capturedAt', 'receivedAt', 'accuracy', 'freshness', 'ageMs', 'readAt']) assert.ok(routes.includes(field));
const serverFiles = git('ls-tree', '-r', '--name-only', backend, 'src').trim().split('\n');
const unsupportedRoutes = [];
for (const file of serverFiles.filter(f => f.endsWith('.ts'))) {
  const source = git('show', `${backend}:${file}`);
  for (const path of ['/v1/contact/trips/:id/location', '/v1/trips/:id/status', '/v1/trips/:id/sharing']) {
    if (source.includes(path)) unsupportedRoutes.push({ file, path });
  }
}
assert.deepEqual(unsupportedRoutes, []);
console.log(JSON.stringify({ runtime: process.version,
  scope: 'Tracked source/test dependency audit; no visual, integration or product acceptance', candidates,
  backend: { sha: backend, locationSourceBlob: git('rev-parse', `${backend}:src/location/routes.ts`).trim(),
    snapshotPath: '/v1/trips/:id/snapshot',
    wire: '{tripId, location:null|{capturedAt,receivedAt,latitude,longitude,accuracy}, freshness, ageMs, readAt}',
    age: 'max(0, serverNow - captured_at)', freshness: 'fresh when ageMs <= 120000; synthetic engineering bound',
    unavailable: 'location=null, freshness=unavailable, ageMs=null',
    noRouteAtInspectedHead: ['/v1/contact/trips/:id/location', '/v1/trips/:id/status', '/v1/trips/:id/sharing'] },
  limits: ['No sourceAge wire field', 'Driver optional monitoringProjection callback defaults to null; not PR53 binding',
    'Foundation main renders FoundationRoot without injected feature routes',
    'No last-response, deadline, delivery or wellbeing authority follows from a location snapshot'] }, null, 2));
