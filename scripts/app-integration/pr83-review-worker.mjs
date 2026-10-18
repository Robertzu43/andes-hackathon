// One real dispatch-process execution; every provider response is a local stub.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createContext} from '../../dist/db.js';
import {runJob} from '../../dist/notifications/dispatch.js';
import {createZavuProvider} from '../../dist/notifications/zavu.js';
import {qualification} from '../../tests/helpers/dispatch.mjs';
assert.equal(process.env.ANDES_APP_INTEGRATION, 'synthetic-only');
const url = new URL(process.env.TEST_DATABASE_URL);
assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/andes_q46_[a-f0-9]{16}$/);
assert.match(url.searchParams.get('options'), /^-c search_path=test_[a-f0-9]{32}$/);
process.once('message', async ({message, clock, status}) => {
  const ctx = createContext(url.toString(), () => new Date(clock));
  const keys = [];
  const provider = createZavuProvider(qualification, 'synthetic-never-live', async (_target, init) => {
    const payload = JSON.parse(init.body);
    keys.push(createHash('sha256').update(payload.idempotencyKey).digest('hex'));
    return new Response(JSON.stringify({code: 'synthetic_control'}), {status});
  });
  try {await runJob(ctx, message, provider, 'q46-independent-worker'); process.send({calls: keys.length, keys});}
  catch {process.send({failed: true}); process.exitCode = 1;}
  finally {await ctx.close(); process.disconnect();}
});
