// FIXTURE, not Atomic Memory: a loopback stand-in for the four documented routes the post-trip note uses
// (POST /v1/memories/ingest/quick, GET /v1/memories/by-external-id/:id, DELETE /v1/memories/:id). It stores
// records in process memory, partitioned by user_id, and answers with the documented snake_case shapes.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function atomicMemoryFixture({ apiKey = 'fixture-key', port = 0 } = {}) {
  const records = new Map(); // `${user_id}\n${externalId}` -> { id, content, user_id }
  const requests = [];
  const state = { delayMs: 0, failStatus: null, ingestStatus: 200, deleteBody: null };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture');
    let body = '';
    for await (const chunk of request) body += chunk;
    const parsed = body ? JSON.parse(body) : undefined;
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: parsed });
    const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
    if (request.headers.authorization !== `Bearer ${apiKey}`) return send(401, { error: 'unauthorized' });
    if (state.failStatus) return send(state.failStatus, { error: 'fixture failure' });
    const user = url.searchParams.get('user_id') ?? parsed?.user_id;
    if (!user) return send(400, { error: 'user_id (string) is required' });
    if (request.method === 'POST' && url.pathname === '/v1/memories/ingest/quick') {
      const externalId = parsed.metadata?.externalId, key = `${user}\n${externalId}`;
      const existing = records.get(key);
      if (existing) { existing.content = parsed.conversation; return send(state.ingestStatus, { episode_id: randomUUID(), memories_stored: 0, memories_updated: 1, stored_memory_ids: [], updated_memory_ids: [existing.id] }); }
      const id = randomUUID(); records.set(key, { id, content: parsed.conversation, user_id: user });
      return send(state.ingestStatus, { episode_id: randomUUID(), memories_stored: 1, memories_updated: 0, stored_memory_ids: [id], updated_memory_ids: [] });
    }
    const byExternal = /^\/v1\/memories\/by-external-id\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'GET' && byExternal) {
      const found = records.get(`${user}\n${decodeURIComponent(byExternal[1])}`);
      return found ? send(200, { id: found.id, content: found.content, user_id: found.user_id }) : send(404, { error: 'Memory not found' });
    }
    const byId = /^\/v1\/memories\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'DELETE' && byId) {
      if (state.deleteBody) return send(200, state.deleteBody);
      for (const [key, found] of records) if (found.id === byId[1] && found.user_id === user) { records.delete(key); return send(200, { success: true }); }
      return send(404, { error: 'Memory not found' });
    }
    send(404, { error: 'not found' });
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, apiKey, records, requests, state, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await atomicMemoryFixture({ port: Number(process.env.FIXTURE_PORT ?? 0) });
  process.stdout.write(`Atomic Memory FIXTURE (not the live service) at ${fixture.url} key=${fixture.apiKey}\n`);
}
