// Native-fetch seam for candidate tests. It cannot forward requests to the network.
import assert from 'node:assert/strict';
import { ORIGIN, clone } from './fixtures.mjs';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export function scriptedTransport(steps) {
  const script = steps.map(step => ({ ...step }));
  const calls = [];
  const fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const call = {
      method: request.method, path: url.pathname + url.search,
      headers: Object.fromEntries(request.headers), bodyText: await request.text(),
      signal: request.signal, cache: request.cache,
    };
    calls.push(call);
    assert.equal(url.origin, ORIGIN, 'candidate used an unapproved synthetic origin');
    const step = script.shift();
    assert.ok(step, 'candidate made an unscripted request (possible retry/replay)');
    assert.equal(call.method, step.method);
    assert.equal(call.path, step.path);
    if (step.body !== undefined) assert.deepEqual(JSON.parse(call.bodyText), step.body);
    if (request.signal.aborted) throw new DOMException('Synthetic cancellation', 'AbortError');
    if (step.outcome === 'network-error') throw new TypeError('Synthetic lost response; commit status unknown');
    let response;
    if (step.wait) {
      if (step.ignoreAbort) response = await step.wait.promise;
      else {
        const aborted = deferred();
        const abort = () => aborted.reject(new DOMException('Synthetic cancellation', 'AbortError'));
        request.signal.addEventListener('abort', abort, { once: true });
        try { response = await Promise.race([step.wait.promise, aborted.promise]); }
        finally { request.signal.removeEventListener('abort', abort); }
      }
    } else if (step.rawBody !== undefined) {
      response = new Response(step.rawBody, {
        status: step.status ?? 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    } else response = jsonResponse(clone(step.response ?? {}), step.status ?? 200);
    return response;
  };
  return {
    fetch, calls,
    assertDrained() { assert.equal(script.length, 0, 'expected request was never made'); },
  };
}

// A clone-isolated, persistent-across-driver-restart test store. Not IndexedDB proof.
export function memoryStore() {
  const values = new Map();
  return {
    async get(key) { return clone(values.get(key)); },
    async put(key, value) { values.set(key, clone(value)); },
    async delete(key) { values.delete(key); },
    async clear() { values.clear(); },
    async entries() { return clone([...values]); },
  };
}
