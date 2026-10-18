import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {BACKEND_SHA} from '../../scripts/app-integration/receipts.mjs';
import {testEnvironment} from '../../scripts/app-integration/runtime.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));

// A private standalone clone: its files and Git excludes cannot alter the live repository.
function privateClone(directory) {
  const clone = join(directory, 'source');
  const git = (...args) => spawnSync('git', args, {cwd: clone, encoding: 'utf8', timeout: 15000});
  const copied = spawnSync('git', ['clone', '--shared', '--no-checkout', '--quiet', repo, clone], {encoding: 'utf8', timeout: 15000});
  assert.equal(copied.status, 0, 'Private Git clone must be available');
  assert.equal(git('checkout', '--detach', '--quiet', 'HEAD').status, 0);
  // Exercise the current working-tree harness, including uncommitted fixes.
  for (const path of ['scripts/app-integration', 'tests/app-integration', 'evidence/app-acceptance']) {
    cpSync(resolve(repo, path), join(clone, path), {recursive: true});
  }
  // Test the guard, not whether HEAD's backend still matches the pin: use the pinned backend source.
  assert.equal(git('checkout', BACKEND_SHA, '--', 'src', 'db', 'package.json', 'package-lock.json', 'tsconfig.json').status, 0);
  symlinkSync(resolve(repo, 'node_modules'), join(clone, 'node_modules'), 'dir');
  return {clone, git};
}

test('source gate rejects ignored runnable migrations and the real export creates no evidence', {timeout: 30000}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'andes-q46-ignored-source-'));
  try {
    const {clone, git} = privateClone(directory);
    const module = pathToFileURL(join(clone, 'scripts/app-integration/source-pin.mjs')).href;
    const program = `import {verifiedBackendSource} from ${JSON.stringify(module)}; try {console.log(verifiedBackendSource());} catch {process.exitCode=1;}`;
    const check = () => spawnSync(process.execPath, ['--input-type=module', '-e', program], {cwd: clone, encoding: 'utf8', timeout: 5000});
    const clean = check();
    assert.equal(clean.status, 0, 'Clean pinned source is the positive control');
    assert.equal(clean.stdout.trim(), BACKEND_SHA);
    const relative = 'db/migrations/999-source-pin-probe.sql';
    assert.match(relative.split('/').at(-1), /^\d{3}-[a-z-]+\.sql$/);
    const exclude = join(clone, '.git/info/exclude');
    writeFileSync(exclude, readFileSync(exclude, 'utf8') + '\n' + relative + '\n');
    writeFileSync(join(clone, relative), 'CREATE TABLE synthetic_guard_probe (id integer);\n');
    assert.equal(git('check-ignore', '-q', relative).status, 0, 'The runtime-visible control really is Git-ignored');
    assert.equal(check().status, 1, 'An ignored runnable migration must invalidate the source pin');
    const output = join(directory, 'must-not-export');
    const run = spawnSync(process.execPath, ['scripts/app-integration/run.mjs'], {
      cwd: clone, env: testEnvironment({APP_INTEGRATION_EVIDENCE_DIR: output}), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(run.status, 1, 'The real export command must reject before starting its database');
    assert.equal(existsSync(output), false);
  } finally {rmSync(directory, {recursive: true, force: true});}
});

test('a failing run writes no receipt, even after the journey captured its exchanges', {timeout: 120000}, () => {
  // Nested run on this run's server: the parent database URL is a loopback administrative URL there.
  const admin = process.env.APP_INTEGRATION_DATABASE_URL;
  assert.ok(admin, 'Run scripts/app-integration/run.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'andes-q46-failed-run-'));
  try {
    const {clone} = privateClone(directory);
    // Keep only the journey, which records a capture, plus one forced failure elsewhere in the suite.
    for (const folder of ['tests', 'tests/app-integration']) {
      for (const name of readdirSync(join(clone, folder))) if (name.endsWith('.test.mjs') && name !== 'journey.test.mjs') rmSync(join(clone, folder, name));
    }
    writeFileSync(join(clone, 'tests/forced-failure.test.mjs'),
      "import test from 'node:test';\ntest('synthetic forced failure', () => { throw new Error('synthetic forced failure'); });\n");
    const output = join(directory, 'must-not-export');
    const run = spawnSync(process.execPath, ['scripts/app-integration/run.mjs'], {cwd: clone, encoding: 'utf8', timeout: 110000,
      env: testEnvironment({APP_INTEGRATION_EVIDENCE_DIR: output, APP_INTEGRATION_ADMIN_URL: admin})});
    // Both facts are needed: the journey really captured exchanges, and the suite really failed.
    assert.match(run.stdout, /(✔|ok \d+ -) synthetic HTTP journey/, 'The journey must pass and capture');
    assert.match(run.stdout, /(✖|not ok \d+ -) synthetic forced failure/, 'The forced failure must run');
    assert.equal(run.status, 1);
    assert.equal(existsSync(output), false, 'A failing run must not write a receipt or its directory');
  } finally {rmSync(directory, {recursive: true, force: true});}
});
