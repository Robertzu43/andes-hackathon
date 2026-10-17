// Checker-only controls. No runtime receipt, HTTP, database or provider execution.
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {syntheticControl} from '../evidence/app-acceptance/synthetic.mjs';
import {evaluate} from '../evidence/app-acceptance/oracle.mjs';

const folder = mkdtempSync(join(tmpdir(), 'andes-q48-checker-'));
const checker = resolve('evidence/app-acceptance/check.mjs');
const synthetic = resolve('evidence/app-acceptance/synthetic.mjs');
const results = [];
function fixture() {
  const data = syntheticControl();
  data.kind = 'isolated-backend-run';
  data.producer = 'SIMULATED CHECKER CONTROL ONLY; not a measured backend run';
  data.command = 'unit-control only; no server executed';
  return data;
}
function run(name, mutate, disposition, expectedExit, target = checker) {
  const data = fixture();
  mutate(data);
  const path = join(folder, 'control.json');
  writeFileSync(path, JSON.stringify(data), {mode: 0o600});
  const direct = evaluate(data);
  const command = spawnSync(process.execPath, [target, path], {encoding: 'utf8'});
  assert.ok(command.stdout.trim(), 'every checker invocation must emit JSON');
  const cli = JSON.parse(command.stdout);
  const passed = direct.disposition === disposition && cli.disposition === disposition &&
    command.status === expectedExit && direct.wholeAppAccepted === false && cli.wholeAppAccepted === false;
  const row = {name, expected: disposition, actual: cli.disposition, expectedExit, exit: command.status,
    wholeAppAccepted: cli.wholeAppAccepted, statuses: cli.cases?.map(c => ({id: c.id, status: c.status})), passed};
  results.push(row);
  console.log(JSON.stringify(row));
}
const scenario = (data, name) => data.cases.find(c => c.id === name);

try {
  run('labelled synthetic is inconclusive', d => { d.kind = 'synthetic-control'; }, 'inconclusive', 2);
  run('simulated backend category remains backend-only', () => {}, 'backend-receipt-checks-pass', 0);
  run('input cannot promote whole-app status', d => { d.wholeAppAccepted = true; }, 'backend-receipt-checks-pass', 0);
  run('missing case stays pending', d => { d.cases = d.cases.filter(c => c.id !== 'owner-resolution'); }, 'inconclusive', 2);
  run('bad source age fails', d => { scenario(d, 'stale-snapshot').steps[1].response.ageMs = 1000; }, 'fix', 1);
  run('changed replay-key alias fails', d => { scenario(d, 'duplicate-confirm').steps[1].keyAlias = 'different-key'; }, 'fix', 1);
  run('invented delivery fails', d => { scenario(d, 'sos-acceptance').steps[0].response.delivered = true; }, 'fix', 1);
  run('different source revision fails', d => { d.backendSha = '5591c9b55fe7f4505e36ccee96d27aa913e0debf'; }, 'fix', 1);
  run('duplicate case IDs fail', d => { d.cases[1].id = d.cases[0].id; }, 'fix', 1);
  run('missing source clock fails', d => { delete scenario(d, 'stale-snapshot').steps[0].response.location.receivedAt; }, 'fix', 1);
  run('different snapshot trip IDs fail', d => { scenario(d, 'stale-snapshot').steps[1].response.tripId = 'another-trip'; }, 'fix', 1);
  run('missing snapshot trip IDs must fail', d => {
    for (const s of scenario(d, 'stale-snapshot').steps) delete s.response.tripId;
  }, 'fix', 1);
  run('resolved second SOS must fail', d => { scenario(d, 'sos-acceptance').steps[1].response.status = 'resolved'; }, 'fix', 1);
  run('invented group support on second SOS must fail', d => { scenario(d, 'sos-acceptance').steps[1].response.groupCapability = 'available'; }, 'fix', 1);

  for (const [source, name] of [[checker, 'check'], [synthetic, 'synthetic']]) {
    const alias = join(folder, name + '-entry.mjs');
    symlinkSync(source, alias);
    if (name === 'check') {
      run('file-symlink checker success emits JSON', () => {}, 'backend-receipt-checks-pass', 0, alias);
      run('file-symlink missing case emits pending JSON', d => { d.cases.pop(); }, 'inconclusive', 2, alias);
    } else {
      const command = spawnSync(process.execPath, [alias], {encoding: 'utf8'});
      const data = JSON.parse(command.stdout);
      const passed = command.status === 0 && data.kind === 'synthetic-control' && evaluate(data).wholeAppAccepted === false;
      results.push({name: 'file-symlink synthetic command emits labelled JSON', exit: command.status, passed});
    }
  }
  for (const [name, content] of [['malformed', 'PRIVATE-FIXED-MARKER {'], ['oversized', 'PRIVATE-FIXED-MARKER '.repeat(30000)]]) {
    const path = join(folder, 'invalid.json');
    writeFileSync(path, content, {mode: 0o600});
    const command = spawnSync(process.execPath, [checker, path], {encoding: 'utf8'});
    const output = JSON.parse(command.stdout);
    const passed = command.status === 1 && output.disposition === 'fix' && output.wholeAppAccepted === false &&
      !command.stdout.includes('PRIVATE-FIXED-MARKER') && !command.stderr.includes('PRIVATE-FIXED-MARKER');
    results.push({name: `${name} receipt fails without echoing input`, exit: command.status, passed});
  }
  const imports = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../evidence/app-acceptance/check.mjs', import.meta.url).href)}); await import(${JSON.stringify(new URL('../evidence/app-acceptance/synthetic.mjs', import.meta.url).href)});`], {encoding: 'utf8'});
  results.push({name: 'imported CLI modules stay inert', passed: imports.status === 0 && imports.stdout === '' && imports.stderr === ''});
  const failures = results.filter(r => !r.passed).map(r => r.name);
  console.log(JSON.stringify({total: results.length, unexpected: failures}));
  if (process.env.REVIEW_RESULT_PATH) writeFileSync(process.env.REVIEW_RESULT_PATH, JSON.stringify(results, null, 2) + '\n');
  process.exitCode = failures.length ? 1 : 0;
} finally { rmSync(folder, {recursive: true, force: true}); }
