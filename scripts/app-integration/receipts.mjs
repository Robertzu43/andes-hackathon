// Redacted observations -> lane52's frozen receipt seam; no result evaluation.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const BACKEND_SHA = 'ebc8fb1d36f441ef012ca585201cefabf61383d6';
export const ORACLE_SHA = 'e3ed9720ad1490a1797adbb3ed1a8c76eadffe50';
export const CASE_LENGTHS = {'setup': 4, 'explicit-confirm': 2, 'duplicate-confirm': 3,
  'stale-snapshot': 2, 'unavailable-snapshot': 1, 'revocation': 3, 'sos-acceptance': 2,
  'acknowledgement-action': 2, 'arrival-preserves-sos': 4, 'owner-resolution': 2,
  'cross-user': 2, 'self-report': 2};
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const routePatterns = ['/v1/me', '/v1/trucks', '/v1/contacts', '/v1/contacts/:id/accept',
  '/v1/trip-drafts', '/v1/trip-drafts/:id/confirm', '/v1/trips/:id', '/v1/trips/:id/snapshot',
  '/v1/trips/:id/contacts/:grantId/revoke', '/v1/trips/:id/sos', '/v1/trips/:id/commands',
  '/v1/incidents/:id', '/v1/incidents/:id/acknowledgements', '/v1/incidents/:id/actions',
  '/v1/incidents/:id/resolve'];
export function routeFor(path) {
  const matches = routePatterns.filter(pattern => new RegExp('^' + pattern.replace(/:(?:id|grantId)/g, uuid) + '$', 'i').test(path));
  assert.equal(matches.length, 1, 'Unregistered receipt path');
  return matches[0];
}

export function recorder(metadata) {
  const ids = new Map(), texts = new Map(), keys = new Map(), exchanges = [];
  const alias = (map, prefix, value) => {
    assert.equal(typeof value, 'string', 'Alias input must be a string');
    if (!map.has(value)) map.set(value, `${prefix}-${map.size + 1}`);
    return map.get(value);
  };
  function select(value, fields) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const result = {};
    for (const key of fields) if (Object.hasOwn(value, key)) {
      const v = value[key];
      if (['id', 'tripId', 'truckId', 'contactId'].includes(key) && typeof v === 'string') result[key] = alias(ids, 'id', v);
      else if (['origin', 'destination', 'action'].includes(key) && typeof v === 'string') result[key] = alias(texts, 'text', v);
      else if (key === 'contactGrantIds' && Array.isArray(v)) result[key] = v.map(id => alias(ids, 'id', id));
      else if (key === 'fields') result[key] = select(v, ['truckId', 'origin', 'destination', 'country', 'locale', 'timeZone']);
      else if (key === 'location') result[key] = select(v, ['capturedAt', 'receivedAt']);
      else {
        assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v), 'Unexpected selected field shape');
        result[key] = v;
      }
    }
    return result;
  }
  return {
    record({method, path, actor, request, status, response, key, bindings}) {
      assert.ok(exchanges.length < 80, 'Bounded HTTP capture exceeded');
      assert.ok(['driver', 'contact', 'stranger'].includes(actor), 'Unknown receipt actor');
      assert.ok(['GET', 'POST'].includes(method) && Number.isInteger(status), 'Invalid observed exchange');
      assert.ok(Array.isArray(bindings) && bindings.length > 0 && bindings.length <= 2);
      for (const [id, index] of bindings) assert.ok(Object.hasOwn(CASE_LENGTHS, id) && Number.isInteger(index) && index >= 0 && index < CASE_LENGTHS[id], 'Unknown case binding');
      exchanges.push({sequence: exchanges.length, observedAt: new Date().toISOString(), bindings: structuredClone(bindings),
        method, route: routeFor(path), actor,
        request: select(request ?? {}, ['contactId', 'map', 'incident', 'fields', 'confirmed', 'contactGrantIds', 'type', 'action']),
        status, response: select(response, ['id', 'tripId', 'status', 'map', 'incident', 'fields', 'command', 'automaticEscalation',
          'groupCapability', 'recorded', 'revoked', 'location', 'freshness', 'ageMs', 'readAt', 'resolvedAt', 'code']),
        ...(method === 'POST' && key ? {keyAlias: alias(keys, 'key', key)} : {})});
    },
    raw() { return {schema: 'andes.app-integration.http/1', ...metadata, exchanges: structuredClone(exchanges)}; },
  };
}

export function adapt(raw) {
  assert.equal(raw.schema, 'andes.app-integration.http/1', 'Unknown raw capture schema');
  assert.ok(['synthetic-control', 'isolated-backend-run'].includes(raw.kind), 'Evidence kind required');
  assert.equal(raw.backendSha, BACKEND_SHA, 'Backend must be rebound through source review');
  assert.equal(raw.externalSends, false); assert.equal(raw.isolatedDatabase, true);
  assert.ok(Array.isArray(raw.exchanges) && raw.exchanges.length <= 80, 'Bounded exchanges required');
  const cases = [];
  for (const [id, length] of Object.entries(CASE_LENGTHS)) {
    const slots = new Map();
    for (const exchange of raw.exchanges) {
      for (const [caseId, index] of exchange.bindings) if (caseId === id) {
        assert.ok(Number.isInteger(index) && index >= 0 && index < length && !slots.has(index), 'Invalid/duplicate observed slot');
        assert.ok(routePatterns.includes(exchange.route), 'Unknown observed route');
        const {method, route, actor, request, status, response, keyAlias, sequence} = exchange;
        slots.set(index, {method, route, actor, request, status, response, ...(keyAlias ? {keyAlias} : {}), sequence});
      }
    }
    // Never synthesize an absent exchange. Omitted/partial cases remain pending.
    if (slots.size !== length) continue;
    const steps = Array.from({length}, (_, i) => slots.get(i));
    assert.ok(steps.every((step, i) => i === 0 || step.sequence > steps[i - 1].sequence), 'Case exchange order differs from observation order');
    cases.push({id, steps: steps.map(({sequence, ...step}) => step)});
  }
  return {schema: 'andes.app-acceptance.receipt/1', kind: raw.kind, backendSha: raw.backendSha,
    externalSends: raw.externalSends, isolatedDatabase: raw.isolatedDatabase,
    producer: raw.producer, command: raw.command, cases};
}

export async function writeCapture(directory, raw) {
  const receipt = adapt(raw);
  for (const [name, value] of [['http-records.json', raw], ['acceptance-receipt.json', receipt]]) {
    const text = JSON.stringify(value, null, 2) + '\n';
    assert.ok(Buffer.byteLength(text) <= 512 * 1024, 'Bounded capture exceeded');
    await writeFile(join(directory, name), text, {mode: 0o600, flag: 'wx'});
  }
}
