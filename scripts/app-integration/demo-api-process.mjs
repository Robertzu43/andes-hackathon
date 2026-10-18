// Runtime wrapper only: all routes, authentication and demo data come from the candidate.
import assert from 'node:assert/strict';
import {basename, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runDatabaseUrl} from './runtime.mjs';

assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
assert.equal(process.env.DEMO_MODE, 'true');
assert.equal(process.env.ZAVU_LIVE_SEND, 'false');
assert.ok(process.connected, 'Private fixture IPC required');
runDatabaseUrl(process.env.DATABASE_URL);
const root = process.env.APP_INTEGRATION_BACKEND_ROOT;
assert.equal(basename(root), 'backend');
assert.ok(basename(dirname(root)).startsWith('andes-q46-browser-demo-'));
const load = path => import(pathToFileURL(join(root, 'dist', path)));
const {createContext, databaseConfig} = await load('db.js');
const {createApp} = await load('api/app.js');
const {demoIssuer} = await load('demo.js');
const demo = await demoIssuer(process.env);
const ctx = createContext(databaseConfig());
const app = createApp({ctx, demo, auth: demo.auth, channelSupport: []});
let closing;
function close() {
  return closing ??= (async () => {
    await app.close();
    if (process.connected) process.disconnect();
  })();
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => void close());
process.once('disconnect', () => void close());
try {
  await app.listen({host: '127.0.0.1', port: Number(process.env.APP_INTEGRATION_API_PORT)});
  process.send({port: app.server.address().port, pid: process.pid});
} catch {
  await close();
  process.exitCode = 1;
}
