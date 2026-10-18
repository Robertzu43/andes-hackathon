// Browser seam: this checkout's web/ app and client against its own backend. Needs `cd web && npm ci`.
import {fileURLToPath} from 'node:url';
import {command, testEnvironment} from './runtime.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const extra = {};
for (const key of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT', 'APP_INTEGRATION_ADMIN_URL']) {
  if (process.env[key]) extra[key] = process.env[key];
}
await command('npm', ['run', 'build']);
await command(process.execPath, ['--test', 'tests/app-integration/browser-proxy.mjs'], {env: testEnvironment(extra)});
