# Demo Personas Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judges open the demo URL in a private window and press "Entrar" with no account. The server creates an isolated synthetic world (driver, family contact, colleague, truck, accepted grants) and returns short-lived tokens for all three personas.

**Architecture:** With `DEMO_MODE=true`, `src/server.ts` builds an in-process RS256 issuer (`src/demo.ts`) and passes its `keyResolver` to the existing `authenticator`, so every route keeps the same JWT checks. A demo server accepts only demo tokens, never real identities. An unauthenticated `POST /v1/demo/session` creates one world per call, behind a global in-memory rate limit. Demo mode refuses to start while live sends are enabled, so synthetic phone numbers can never receive a message.

**Tech Stack:** TypeScript, Fastify 5, jose 6, pg 8.

**Decision:** Robert, 2026-10-17 ("demo personas"). **Depends on:** the security checks plan, Task 1 (`contact_grants.role`, migration 003). **Owner:** `andes-hackathon-a4`, branch `hackathon/delivery`.

**Known limits** (mark with `ponytail:` comments):
- The signing key lives in memory, so tokens die on restart and the demo service must run a single instance.
- The rate limit is global, not per client.

---

### Task 1: Demo issuer and session endpoint

**Files:**
- Create: `src/demo.ts`, `tests/demo.test.mjs`
- Modify: `src/api/app.ts` (options, one exemption line, registration), `src/server.ts`, `docs/contracts/runtime.md`, `.env.example`

- [ ] **Step 1: Write the failing tests** in `tests/demo.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';

async function demoFixture(t) {
  const {demoIssuer} = await import('../dist/demo.js');
  const demo = await demoIssuer({});
  const f = await fixture(t, {auth: demo.auth, demo});
  const session = async () => { const r = await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}}); return {status: r.statusCode, body: r.json()}; };
  return {f, session};
}

test('a demo session creates an isolated synthetic world whose personas can run the whole journey', async t => {
  const {f, session} = await demoFixture(t);
  const world = await session();
  assert.equal(world.status, 200);
  assert.equal(world.body.synthetic, true);
  const {driver, family, colleague} = world.body;
  assert.equal((await f.req('GET', '/v1/me', undefined, driver.token)).body.id, driver.id);
  const draft = await f.req('POST', '/v1/trip-drafts', {text: 'Lima a Ica, llego 18:00', fields: {truckId: driver.truckId, origin: 'Lima', destination: 'Ica', country: 'PE', locale: 'es-PE', timeZone: 'America/Lima'}}, driver.token);
  assert.equal(draft.status, 200);
  const trip = (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [family.grantId, colleague.grantId]}, driver.token)).body.id;
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, family.token)).status, 200);
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {}, driver.token)).status, 200);
  assert.deepEqual((await f.ctx.pool.query("SELECT cg.role,count(*)::int n FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id GROUP BY cg.role ORDER BY cg.role")).rows,
    [{role: 'colleague', n: 2}, {role: 'family', n: 3}]);
  const other = (await session()).body;
  assert.notEqual(other.driver.id, driver.id);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, other.family.token)).status, 403);
});

test('demo sessions are rate limited, and demo mode refuses live sends', async t => {
  const {f, session} = await demoFixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await session()).status, 200);
  assert.deepEqual(await session(), {status: 429, body: {code: 'demo_rate_limited'}});
  f.advance(60001);
  assert.equal((await session()).status, 200);
  const {demoIssuer} = await import('../dist/demo.js');
  await assert.rejects(demoIssuer({ZAVU_LIVE_SEND: 'true'}), /never sends live/);
});

test('without demo mode the session route does not exist and real tokens are unaffected', async t => {
  const f = await fixture(t);
  assert.notEqual((await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).statusCode, 200);
  assert.equal((await f.req('GET', '/v1/me')).status, 200);
});
```

- [ ] **Step 2: Run them to verify they fail.** `npm run build && node --test tests/demo.test.mjs`. Expected: FAIL with `Cannot find module '.../dist/demo.js'`.

- [ ] **Step 3: Create** `src/demo.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import type { AuthConfig } from './auth.js';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { empty } from './api/schemas.js';
export interface DemoIssuer { auth: AuthConfig; sign(subject: string, phone: string): Promise<string> }
const issuer = 'https://demo.andes.invalid', audience = 'andes-demo';
// Synthetic numbers: demo mode refuses live sends, so they are never contacted.
const people = [{ key: 'driver', phone: '+51900000101' }, { key: 'family', phone: '+51900000102' }, { key: 'colleague', phone: '+51900000103' }] as const;
/** ponytail: in-memory key; tokens die on restart and the demo must run one instance. */
export async function demoIssuer(env: NodeJS.ProcessEnv): Promise<DemoIssuer> {
  if (env.ZAVU_LIVE_SEND === 'true') throw new Error('DEMO_MODE never sends live messages; unset ZAVU_LIVE_SEND');
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return {
    auth: { issuer, audience, keyResolver: async () => publicKey },
    sign: (subject, phone) => new SignJWT({ phone_number: phone, phone_number_verified: true }).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime('2h').sign(privateKey)
  };
}
export function demoRoutes(app: FastifyInstance, ctx: Context, demo: DemoIssuer) {
  let windowStart = 0, created = 0;
  app.post('/v1/demo/session', { schema: { body: empty } }, async () => {
    const now = ctx.clock().getTime();
    if (now - windowStart > 60000) { windowStart = now; created = 0; }
    // ponytail: one global limit for a single demo instance; per-client limits if this outlives the event.
    if (++created > 30) problem(429, 'demo_rate_limited');
    const world = randomUUID();
    const ids = Object.fromEntries(people.map(p => [p.key, randomUUID()])) as Record<(typeof people)[number]['key'], string>;
    const truckId = randomUUID(), grants = { family: randomUUID(), colleague: randomUUID() };
    await transaction(ctx.pool, async client => {
      for (const p of people) await client.query('INSERT INTO identities(id,issuer,subject,phone,phone_verified) VALUES($1,$2,$3,$4,true)', [ids[p.key], issuer, `${world}:${p.key}`, p.phone]);
      await client.query('INSERT INTO trucks VALUES($1,$2,$3)', [truckId, ids.driver, 'ABC-123 (demo)']);
      for (const role of ['family', 'colleague'] as const) await client.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES($1,$2,$3,$4,true,true,true,true,$5,$6)`, [grants[role], ids.driver, ids[role], people.find(p => p.key === role)!.phone, ctx.clock(), role]);
    });
    const token = (key: (typeof people)[number]['key']) => demo.sign(`${world}:${key}`, people.find(p => p.key === key)!.phone);
    return { synthetic: true, expiresInSeconds: 7200,
      driver: { id: ids.driver, token: await token('driver'), truckId },
      family: { id: ids.family, token: await token('family'), grantId: grants.family },
      colleague: { id: ids.colleague, token: await token('colleague'), grantId: grants.colleague } };
  });
}
```

- [ ] **Step 4: Wire `createApp`** in `src/api/app.ts`:
  - add `import { demoRoutes, type DemoIssuer } from '../demo.js';`;
  - extend `AppOptions` with `demo?: DemoIssuer` and destructure `demo` in `createApp`;
  - add a **new line** at the top of the `onRequest` hook, after `reply.header(...)` and before the existing `/health` exemption line (do not edit that line; Part 2 changes it): `if (demo && request.routeOptions.url === '/v1/demo/session') return;`;
  - add `if (demo) demoRoutes(app, ctx, demo);` as its own line directly before `app.get('/v1/me', ...)`.

- [ ] **Step 5: Wire `src/server.ts`.** Replace the OIDC guard and the `createApp` call:

```ts
const demo = process.env.DEMO_MODE === 'true' ? await demoIssuer(process.env) : undefined;
if (!demo && (!OIDC_ISSUER || !OIDC_AUDIENCE || !OIDC_JWKS_URL)) throw new Error('Trusted OIDC configuration required');
```

and pass `auth: demo?.auth ?? { issuer: OIDC_ISSUER!, audience: OIDC_AUDIENCE!, jwksUrl: OIDC_JWKS_URL! }, demo`. Import `demoIssuer` from `./demo.js`.

- [ ] **Step 6: Run the tests to verify they pass.** `npm run build && node --test tests/demo.test.mjs`, then `npm test`. Expected: PASS.

- [ ] **Step 7: Document.**
  - In `docs/contracts/runtime.md`, add a `## Demo mode` section covering:
    - `DEMO_MODE=true` replaces OIDC with an in-process demo issuer, and real tokens are rejected;
    - `POST /v1/demo/session` takes `{}`, is unauthenticated and has no Idempotency-Key (a deliberate exception), and returns synthetic personas with 2-hour tokens;
    - the limit of 30 worlds per minute per instance;
    - single instance, because tokens die on restart;
    - refusal to start when `ZAVU_LIVE_SEND=true`;
    - never enable it on a deployment with real users.
  - In `.env.example`, add a commented `# DEMO_MODE=true`.

- [ ] **Step 8: Commit.**

```bash
git add src/demo.ts src/api/app.ts src/server.ts tests/demo.test.mjs docs/contracts/runtime.md .env.example
git commit -m "feat(demo): Add synthetic persona sign-in for the judges' demo"
```
