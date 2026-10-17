// Explicit opt-in: this needs frozen foundation dependencies, unlike backend tests.
import {fileURLToPath} from 'node:url';
import {command, testEnvironment} from './runtime.mjs';
import {verifiedBackendSource} from './source-pin.mjs';

process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
verifiedBackendSource();
const extra = {APP_INTEGRATION_WEB_ROOT: process.env.APP_INTEGRATION_WEB_ROOT};
for (const key of ['APP_INTEGRATION_PG_BIN', 'APP_INTEGRATION_PG_PORT', 'APP_INTEGRATION_ADMIN_URL']) {
  if (process.env[key]) extra[key] = process.env[key];
}
await command('npm', ['run', 'typecheck']);
await command('npm', ['run', 'build']);
await command(process.execPath, ['--test', 'tests/app-integration/browser-proxy.mjs'], {env: testEnvironment(extra)});
