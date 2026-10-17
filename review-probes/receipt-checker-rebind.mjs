// Explicit revision binding for the unchanged 7a15e85 twenty-control oracle.
// The only bound datum is its foreign-revision input; predicates stay unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const approved = '5591c9b55fe7f4505e36ccee96d27aa913e0debf';
const old = 'ebc8fb1d36f441ef012ca585201cefabf61383d6';
const foreign = '0000000000000000000000000000000000000000';
const originalHash = 'd3714238dbf65668f739f6da0b63dc40b1ad284215fa69ffb90e7f1c38670d9b';
const hash = text => createHash('sha256').update(text).digest('hex');
const candidate = resolve(process.argv[2] ?? '.');
const source = readFileSync(new URL('./receipt-checker-probes.mjs', import.meta.url), 'utf8');
assert.equal(hash(source), originalHash, 'original twenty-control probe bytes changed');
const {BACKEND_SHA, evaluate} = await import(pathToFileURL(join(candidate, 'evidence/app-acceptance/oracle.mjs')));
const {syntheticControl} = await import(pathToFileURL(join(candidate, 'evidence/app-acceptance/synthetic.mjs')));

if (BACKEND_SHA !== approved) {
  console.log(JSON.stringify({driver: 'q48-rebind/1', passed: false, reason: 'candidate has not bound the approved backend',
    expectedBackend: approved, actualBackend: BACKEND_SHA, originalProbeSha256: originalHash}));
  process.exitCode = 1;
} else {
  const pinChecks = [];
  for (const [name, backendSha, expected] of [
    ['reviewed backend is accepted only as backend evidence', approved, 'backend-receipt-checks-pass'],
    ['old EBC backend is rejected', old, 'fix'],
    ['foreign backend is rejected', foreign, 'fix'],
  ]) {
    const control = syntheticControl();
    control.kind = 'isolated-backend-run';
    control.producer = 'SIMULATED REBIND UNIT CONTROL; not a measured backend run';
    control.command = 'revision unit control only; no server executed';
    control.backendSha = backendSha;
    const result = evaluate(control);
    pinChecks.push({name, expected, actual: result.disposition, wholeAppAccepted: result.wholeAppAccepted,
      passed: result.disposition === expected && result.wholeAppAccepted === false});
  }

  const needle = `d.backendSha = '${approved}'`;
  assert.equal(source.split(needle).length, 2, 'expected exactly one revision-negative input binding');
  const rebound = source.replace(needle, `d.backendSha = '${old}'`);
  // A temporary sibling directory preserves ../evidence imports and candidate CLI
  // paths. Neither the frozen oracle file nor any candidate source is modified.
  const temporary = mkdtempSync(join(candidate, '.q48-rebind-'));
  let command;
  try {
    const entry = join(temporary, 'probes.mjs');
    writeFileSync(entry, rebound, {mode: 0o600});
    command = spawnSync(process.execPath, [entry], {cwd: candidate, encoding: 'utf8', env: process.env});
    process.stdout.write(command.stdout ?? '');
    process.stderr.write(command.stderr ?? '');
  } finally { rmSync(temporary, {recursive: true, force: true}); }

  let summary;
  try { summary = JSON.parse(command.stdout.trim().split('\n').at(-1)); } catch { summary = null; }
  const allTwenty = command.status === 0 && summary?.total === 20 &&
    Array.isArray(summary.unexpected) && summary.unexpected.length === 0;
  const result = {driver: 'q48-rebind/1', approvedBackend: approved, originalProbeSha256: originalHash,
    boundProbeSha256: hash(rebound), onlyBinding: {from: approved, to: old, meaning: 'revision-negative input'},
    pinChecks, originalControlCount: summary?.total ?? null, originalUnexpected: summary?.unexpected ?? null,
    originalControlExit: command.status, allTwentyExpected: allTwenty,
    passed: allTwenty && pinChecks.every(c => c.passed), wholeAppAccepted: false};
  console.log(JSON.stringify(result));
  if (process.env.REVIEW_REBIND_RESULT_PATH) writeFileSync(process.env.REVIEW_REBIND_RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.passed ? 0 : 1;
}
