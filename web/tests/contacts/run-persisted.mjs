// Bounded local test fixture, not a development service or deployment.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const postgres = process.env.ANDES_TEST_POSTGRES ?? '/opt/homebrew/bin/postgres';
const initdb = process.env.ANDES_TEST_INITDB ?? '/opt/homebrew/bin/initdb';
const work = mkdtempSync('/private/tmp/andes-l51-');
const socket = join(work, 'socket'); mkdirSync(socket, { mode: 0o700 });
const data = join(work, 'data');
let database; let tests;
const interrupt = () => tests ? tests.kill('SIGTERM') : database?.kill('SIGTERM');
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  execFileSync(initdb, ['-D', data, '-U', 'andes_lane51', '-A', 'trust', '--no-locale', '--encoding=UTF8'], { stdio: 'ignore' });
  database = spawn(postgres, ['-D', data, '-k', socket, '-h', '', '-p', '65451'], { stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated test PostgreSQL did not become ready')), 20_000);
    database.once('error', error => { clearTimeout(timer); reject(error); });
    database.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated test PostgreSQL exited before readiness')); });
    database.stderr.on('data', chunk => {
      if (chunk.toString().includes('database system is ready to accept connections')) { clearTimeout(timer); ready(); }
    });
  });
  console.log('Lane51 isolated PostgreSQL ready: private Unix socket only; no TCP listener');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc'], { cwd: resolve('.'), stdio: 'inherit' });
  const url = new URL('postgresql://andes_lane51@localhost:65451/postgres');
  url.searchParams.set('host', socket);
  tests = spawn(process.execPath, ['--test', 'web/tests/contacts/persisted.test.mjs'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url.toString(), ZAVU_LIVE_SEND: 'false' },
  });
  tests.once('error', () => { process.exitCode = 1; });
  const [code] = await once(tests, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (database && database.exitCode === null && database.signalCode === null) {
    const stopped = once(database, 'exit');
    database.kill('SIGTERM'); await stopped;
  }
  rmSync(work, { recursive: true, force: true });
  console.log('Lane51 isolated test database stopped and removed');
}
