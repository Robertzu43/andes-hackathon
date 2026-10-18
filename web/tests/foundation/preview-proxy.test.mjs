import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { preview } from 'vite';

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

test('production preview returns an honest unavailable API rather than SPA HTML', async () => {
  const old = process.env.ANDES_API_PROXY_TARGET;
  delete process.env.ANDES_API_PROXY_TARGET;
  const app = await preview({ envFile: false, preview: { host: '127.0.0.1', port: 0 } });
  try {
    const origin = `http://127.0.0.1:${app.httpServer.address().port}`;
    for (const path of ['/v1', '/v1?probe=1', '/v1/', '/v1/me?probe=1']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 503, path);
      assert.equal(response.headers.get('cache-control'), 'no-store', path);
      assert.deepEqual(await response.json(), { code: 'api_unconfigured' });
    }
    assert.equal((await fetch(`${origin}/v10?probe=1`)).status, 200);
    assert.equal((await fetch(`${origin}/session`)).status, 200);
  } finally { await close(app.httpServer); if (old === undefined) delete process.env.ANDES_API_PROXY_TARGET; else process.env.ANDES_API_PROXY_TARGET = old; }
});

test('production preview proxies exact API paths, status and idempotency headers to an owned fixture', async () => {
  const old = process.env.ANDES_API_PROXY_TARGET;
  const fixture = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/v1?probe=1') {
      response.end(JSON.stringify({ requestTarget: request.url })); return;
    }
    if (request.method === 'GET' && request.url === '/v1/me') {
      response.end(JSON.stringify({ id: '00000000-0000-4000-8000-000000000049' })); return;
    }
    response.statusCode = request.headers['idempotency-key'] === 'fixture-key' ? 409 : 401;
    response.end(JSON.stringify({ code: response.statusCode === 409 ? 'fixture_conflict' : 'unauthorized' }));
  });
  await listen(fixture);
  process.env.ANDES_API_PROXY_TARGET = `http://127.0.0.1:${fixture.address().port}`;
  let app;
  try {
    app = await preview({ envFile: false, preview: { host: '127.0.0.1', port: 0 } });
    const origin = `http://127.0.0.1:${app.httpServer.address().port}`;
    assert.deepEqual(await (await fetch(`${origin}/v1?probe=1`)).json(), { requestTarget: '/v1?probe=1' });
    for (const path of ['/v10', '/v1evil', '/v1-admin']) {
      const response = await fetch(`${origin}${path}`);
      assert.match(response.headers.get('content-type'), /text\/html/, path);
    }
    assert.deepEqual(await (await fetch(`${origin}/v1/me`)).json(), { id: '00000000-0000-4000-8000-000000000049' });
    const conflict = await fetch(`${origin}/v1/trucks`, { method: 'POST', headers: { 'Idempotency-Key': 'fixture-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Fixture' }) });
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), { code: 'fixture_conflict' });
    assert.equal((await fetch(`${origin}/v1/trucks`, { method: 'POST' })).status, 401);
  } finally { if (app) await close(app.httpServer); await close(fixture); if (old === undefined) delete process.env.ANDES_API_PROXY_TARGET; else process.env.ANDES_API_PROXY_TARGET = old; }
});
