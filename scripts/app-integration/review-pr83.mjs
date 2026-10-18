// Reproduce exact-source runtime review without rebinding the existing app fixture.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {copyFile, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {disposableDatabase, testEnvironment} from './runtime.mjs';

const candidate = 'b95ff267d297d1fe1f27fa8b016940996690691c';
const before = '41c4529b62a466f8b45d5b447001013194520645';
const repo = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(repo);
assert.ok(Number(process.versions.node.split('.')[0]) >= 24 && Number(process.versions.node.split('.')[0]) < 27);
const proof = await mkdtemp(join(tmpdir(), 'andes-q46-review83-'));
const protectedPaths = ['src', 'db', 'package.json', 'package-lock.json', 'tsconfig.json'];
const git = (cwd, args) => spawnSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 1024 * 1024});
const blob = (sha, path) => {const r = git(repo, ['show', `${sha}:${path}`]); assert.equal(r.status, 0); return r.stdout;};
function sourceGuard(root, sha) {
  assert.equal(git(root, ['diff', '--quiet', sha, '--', ...protectedPaths]).status, 0, 'Protected source differs');
  const others = git(root, ['ls-files', '--others', '--', ...protectedPaths]);
  assert.equal(others.status, 0); assert.equal(others.stdout.trim(), '', 'Ignored runtime extras also invalidate source');
}
let runtime;
const summary = {candidate, negativeBaseline: before, sourceVerified: false, wholeAppAccepted: false, runs: []};
try {
  runtime = await disposableDatabase();
  const env = testEnvironment({TEST_DATABASE_URL: runtime.url});
  for (const [name, sha] of [['candidate', candidate], ['before-five-fixes', before]]) {
    const root = join(proof, name);
    assert.equal(git(repo, ['clone', '--shared', '--no-checkout', '--quiet', repo, root]).status, 0);
    assert.equal(git(root, ['checkout', '--detach', '--quiet', sha]).status, 0);
    assert.equal(blob(sha, 'package-lock.json'), await readFile(join(repo, 'package-lock.json'), 'utf8'), 'Review requires lock-matching existing dependencies');
    await symlink(join(repo, 'node_modules'), join(root, 'node_modules'), 'dir');
    // These directories are inside the review namespace; source guards exclude no runtime files.
    const {mkdir} = await import('node:fs/promises');
    await mkdir(join(root, 'tests/app-integration'), {recursive: true});
    await mkdir(join(root, 'scripts/app-integration'), {recursive: true});
    for (const path of ['tests/app-integration/pr83-runtime-review.mjs', 'scripts/app-integration/pr83-review-worker.mjs']) {
      await copyFile(join(repo, path), join(root, path));
    }
    await writeFile(join(root, 'tests/hardening.test.mjs'), blob(candidate, 'tests/hardening.test.mjs'));
    sourceGuard(root, sha);
    const checks = [['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit'], 0],
      ['build', ['node_modules/typescript/bin/tsc'], 0],
      ['author-hardening', ['--test', 'tests/hardening.test.mjs'], name === 'candidate' ? 0 : 1],
      ['independent-runtime', ['--test', 'tests/app-integration/pr83-runtime-review.mjs'], name === 'candidate' ? 0 : 1]];
    for (const [check, args, expected] of checks) {
      const run = spawnSync(process.execPath, args, {cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024});
      await writeFile(join(proof, `${name}-${check}.log`), run.stdout + run.stderr, {mode: 0o600});
      const counts = Object.fromEntries(['tests','pass','fail'].map(key => [key, Number(run.stdout.match(new RegExp(`(?:ℹ |# )${key} (\\d+)`))?.[1] ?? -1)]));
      summary.runs.push({source: sha, name, check, exit: run.status, ...counts});
      console.log(JSON.stringify(summary.runs.at(-1)));
      assert.equal(run.status, expected, `${name} ${check}; inspect private raw output`);
    }
    sourceGuard(root, sha);
    // Retain raw records, not checkouts, credentials or the disposable database.
    await rm(root, {recursive: true, force: true});
  }
  summary.sourceVerified = true;
} finally {
  await runtime?.cleanup();
  await writeFile(join(proof, 'review-result.json'), JSON.stringify(summary, null, 2) + '\n', {mode: 0o600});
  console.log(`Private review proof: ${proof}`);
}
