// Run the accepted, immutable native-TS client against this lane's real backend.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {command, testEnvironment} from './runtime.mjs';
import {verifiedBackendSource} from './source-pin.mjs';

export const CLIENT_SHA = '78efad0a207e98cc44336a03ba6af9fc0c1d2901';
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
verifiedBackendSource();
const directory = await mkdtemp(join(tmpdir(), 'andes-q46-client-'));
try {
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const name of ['index', 'client', 'session', 'errors', 'responses', 'types']) {
    const source = spawnSync('git', ['show', `${CLIENT_SHA}:web/src/lib/api/${name}.ts`]);
    assert.equal(source.status, 0, 'Fetch the frozen PR59 client object before running this seam');
    await writeFile(join(directory, `${name}.ts`), source.stdout);
  }
  const extra = {APP_INTEGRATION_CLIENT_MODULE: join(directory, 'index.ts'), APP_INTEGRATION_CLIENT_SHA: CLIENT_SHA};
  for (const key of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT', 'APP_INTEGRATION_ADMIN_URL']) {
    if (process.env[key]) extra[key] = process.env[key];
  }
  console.log(`Client seam: frozen ${CLIENT_SHA}; native TypeScript; synthetic signed sessions; real loopback HTTP/PostgreSQL`);
  await command(process.execPath, ['scripts/app-integration/run.mjs'], {env: testEnvironment(extra)});
} finally {await rm(directory, {recursive: true, force: true});}
