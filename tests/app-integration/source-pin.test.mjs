import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {BACKEND_SHA} from '../../scripts/app-integration/receipts.mjs';
import {testEnvironment} from '../../scripts/app-integration/runtime.mjs';

test('source gate rejects ignored runnable migrations and the real export creates no evidence', {timeout: 30000}, () => {
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'andes-q46-ignored-source-'));
  const clone = join(directory, 'source');
  const git = (...args) => spawnSync('git', args, {cwd: clone, encoding: 'utf8', timeout: 15000});
  try {
    const copied = spawnSync('git', ['clone', '--shared', '--no-checkout', '--quiet', repo, clone], {encoding: 'utf8', timeout: 15000});
    assert.equal(copied.status, 0, 'Private Git clone must be available');
    assert.equal(git('checkout', '--detach', '--quiet', 'HEAD').status, 0);
    // Exercise the current working-tree guard, including an uncommitted fix.
    for (const path of ['scripts/app-integration/source-pin.mjs', 'scripts/app-integration/receipts.mjs', 'evidence/app-acceptance/oracle.mjs']) {
      cpSync(resolve(repo, path), join(clone, path));
    }
    // Test the guard, not whether HEAD's backend still matches the pin: use the pinned backend source.
    assert.equal(git('checkout', BACKEND_SHA, '--', 'src', 'db', 'package.json', 'package-lock.json', 'tsconfig.json').status, 0);
    const module = pathToFileURL(join(clone, 'scripts/app-integration/source-pin.mjs')).href;
    const program = `import {verifiedBackendSource} from ${JSON.stringify(module)}; try {console.log(verifiedBackendSource());} catch {process.exitCode=1;}`;
    const check = () => spawnSync(process.execPath, ['--input-type=module', '-e', program], {cwd: clone, encoding: 'utf8', timeout: 5000});
    const clean = check();
    assert.equal(clean.status, 0, 'Clean pinned source is the positive control');
    assert.equal(clean.stdout.trim(), BACKEND_SHA);
    const relative = 'db/migrations/999-source-pin-probe.sql';
    assert.match(relative.split('/').at(-1), /^\d{3}-[a-z-]+\.sql$/);
    // This is a standalone clone: its info/exclude cannot alter the live repository.
    const exclude = join(clone, '.git/info/exclude');
    writeFileSync(exclude, readFileSync(exclude, 'utf8') + '\n' + relative + '\n');
    writeFileSync(join(clone, relative), 'CREATE TABLE synthetic_guard_probe (id integer);\n');
    assert.equal(git('check-ignore', '-q', relative).status, 0, 'The runtime-visible control really is Git-ignored');
    assert.equal(check().status, 1, 'An ignored runnable migration must invalidate the source pin');
    symlinkSync(resolve(repo, 'node_modules'), join(clone, 'node_modules'), 'dir');
    const output = join(directory, 'must-not-export');
    const run = spawnSync(process.execPath, ['scripts/app-integration/run.mjs'], {
      cwd: clone, env: testEnvironment({APP_INTEGRATION_EVIDENCE_DIR: output}), encoding: 'utf8', timeout: 5000,
    });
    assert.equal(run.status, 1, 'The real export command must reject before starting its database');
    assert.equal(existsSync(output), false);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
