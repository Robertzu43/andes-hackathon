# Phone Demo · Plan A (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The backend serves the built web app on one HTTPS origin and runs a demo mode in which a contact verifies their own phone number with an SMS code. Real alerts then go only to numbers verified that way in the same demo world, within explicit caps. Abandoned worlds lose their numbers after 24 h.

**Architecture:** `src/api/web.ts` serves `web/dist` (a MIME map, a `..` block and cache headers in a few lines, no new dependency), with an `index.html` fallback for every non-`/v1` path, outside the auth hook. Fastify trusts exactly `TRUST_PROXY_HOPS` proxies. A new `src/demo-phone.ts` holds the demo settings parser, the two OTP routes (HMAC with `DEMO_PHONE_PEPPER`, caps checked under one advisory lock, the SMS sent after commit through the Zavu adapter as `sms_oneway`) and the purge. Migration 010 adds `demo_phone_challenges` and `demo_phone_verifications`. In `authorizeJob`, an explicit `DemoDispatch` policy replaces the static allowlist with "a verification row for this recipient and this exact number". Without that policy, a synthetic (demo) recipient is never contacted. Alert wording drops URLs from SMS (Zavu holds SMS with unverified URLs) and drops IDs from calls.

**Tech Stack:** TypeScript 5.9 (strict ESM, NodeNext), Fastify 5.12, pg 8, PostgreSQL 15+ (CI uses 18), jose 6, the Node test runner against the compiled `dist/`. The web side is React 19 and Vite 8 under `web/`, touched only for the demo-session decoder.

**Spec:** `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md`, §9 steps 1–2 plus the backend parts of §1, §4, §5, §6 and §7. Tasks 1–3 are step 1 (serving, proxy, Docker). Tasks 4–12 are step 2. If step 1 ships as its own PR, take Task 12's "Run and identity" and web-route edits with it.

---

## Shared contract with Plan B (web)

Keep this exactly:

- `POST /v1/demo/session` → 200 `{ expiresAt, tripCountries: string[], driver: { id, token }, family: { id, token }, colleague: { id, token, grantId } }`.
- `POST /v1/demo/phone/start` `{phone}` → 202 `{ expiresAt }`. Errors: 400 `invalid_phone`, 403 `country_not_allowed`, 429 `rate_limited`, 429 `demo_budget_exhausted`, 503 `demo_sms_disabled`.
- `POST /v1/demo/phone/verify` `{phone, code}` → 200 `{ verified: true }`. Errors: 400 `invalid_code`, 410 `code_expired`, 429 `too_many_attempts`.
- Use the repo's existing error body shape (look at `problem()` in src).

Notes that keep it exact:
- The error body is `{ code }`. `problem()` (`src/contracts.ts:25`) throws it, and the error handler (`src/api/app.ts:30-35`) maps every 5xx to 500 `internal_error`. So the one 503 is sent directly as `{ code: 'demo_sms_disabled' }`.
- The session response also keeps today's `synthetic: true` and `expiresInSeconds: 7200`. They are additive: the web decoder ignores unknown fields, and the current web world-lifetime logic (`web/src/lib/api/demo.ts:20,82`) reads `expiresInSeconds`.
- A body that is not an object with a string `phone` (or `code`) is 400 `invalid_request`, the repo's schema error. Any string that is not E.164 is 400 `invalid_phone`.

## Spec ambiguities resolved here

1. **`tripCountries`** are the sorted, distinct countries of the Zavu qualification entries, live or not. Without a qualification they are `[]`. `demoIssuer(env)` computes them, so every existing `demoIssuer({})` call keeps working.
2. **One-way SMS** is a top-level qualification option, `smsMode: "oneway"`, because the account has one SMS sender. Send and read-back use it strictly. Callbacks always map `sms_oneway` to `sms`, because the callback config has no qualification. Correlation still needs the exact message ID, sender and destination hash.
3. **SMS without URLs** (coordinator finding): an alert SMS gives the coordinates as `lat, lon` text and has no `Ver:` link. WhatsApp keeps both links. Calls drop the incident ID. The code SMS has no URL.
4. **Caps** use rolling windows: per number and per IP over the last 60 minutes, the global code SMS cap and the per-number alert cap over the last 24 h (not the UTC day). The global code SMS cap is checked first.
5. **A provider refusal of a code SMS** still counts against the caps, so failures cannot be retried past them, and answers 503 `demo_sms_disabled`. An ambiguous provider result answers 202.
6. **The phone routes take no Idempotency-Key**. This is a demo exception, like `/v1/demo/session`.
7. **Country check** uses calling-code prefixes: AR 54, BR 55, CL 56, CO 57, MX 52, PE 51, US 1. US means all of +1 (NANP). The default `DEMO_ALLOWED_COUNTRIES` is `PE`. An unknown code fails startup.
8. **"A missing demo config fails closed"** means three things. A live `DEMO_MODE` worker without `demoLimits`, `DEMO_ALERTS_PER_NUMBER_DAILY`, `DEMO_SMS_DAILY_CAP` or `DEMO_PHONE_PEPPER` refuses to start. `authorizeJob` never contacts a synthetic recipient without a `DemoDispatch` policy. A policy without a numeric per-number cap, or a qualification without `demoLimits`, ends `demo_budget_exhausted`.
9. **The static `allowedDestinations` is replaced, not combined**, when the demo policy is on.
10. **The purge overwrites `contact_grants.phone` with `''`** instead of deleting the row: `trip_grants.grant_id` and `jobs.grant_id` reference it (`db/migrations/001-core.sql`). It also clears `dispatch_attempts.payload`, which holds `to`. Destination SHA-256 hashes stay as evidence. The purge runs only in demo mode, every 10 minutes.
11. **`createApp` trusts no proxy by default** (`trustProxyHops = 0`). `src/server.ts` passes `TRUST_PROXY_HOPS`, which defaults to 1 and must be an integer from 0 to 3.
12. **The phone routes are registered only when both the demo issuer and the `demoPhone` config are passed.** The fake sender and fixed code exist only as the in-process `demoPhone.code`/`send` options. `demoLimits(env)` never reads a code.
13. **The server fails at startup without `web/dist/index.html`**, instead of serving 404s.
14. **`DEMO_PHONE_PEPPER`** needs at least 32 characters. With sends off and no pepper, a random per-process pepper is used, because no code can be stored then.

## Commands

From the worktree root:
- Test DB: `export TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/andes_test`, a disposable database (CI uses `postgres:18-bookworm`).
- One file: `npm run build && node --test tests/<file>.test.mjs`
- Backend suite: `npm test`. Typecheck: `npm run typecheck`.
- Web suite (Task 6 only): `cd web && npm ci && npm test` (its `pretest` runs `tsc --noEmit && vite build`).

All phones in tests are fictional: `+1 555 555 01xx`, or `+51 0…`, which is not an assigned Peruvian mobile range.

Line numbers refer to the file before the task's own edits. Every edit also quotes its anchor text, so match by the anchor once an earlier insertion has shifted the lines. Where only line ranges are given, the task says to apply them from the bottom up.

---

## File structure

| File | Responsibility |
|---|---|
| `src/api/web.ts` (create) | `webRoutes`: serve `web/dist` files by extension and `index.html` for app paths; `isWebRoute` for the auth hook |
| `src/api/app.ts` (modify) | Options `webRoot`, `trustProxyHops`, `demoPhone`; auth-hook exemption; route registration |
| `src/server.ts` (modify) | `HOST`, `TRUST_PROXY_HOPS`, web root, demo phone config wiring |
| `Dockerfile`, `.dockerignore` (modify) | Build `web/` in its own stage, ship `web/dist`; ignore nested `node_modules`/`dist` |
| `src/notifications/zavu.ts` (modify) | `smsMode: 'oneway'`; `sms_oneway` on send, read-back and callbacks; `textPayload` for code SMS |
| `src/notifications/wording.ts` (modify) | Per-channel summary: SMS without URLs, voice without IDs |
| `src/notifications/dispatch.ts` (modify) | `DemoDispatch`; fail-closed OTP allowlist; per-number daily cap; pass the policy through `runJob`/`consume`; channel to wording |
| `src/demo.ts` (modify) | Session without truck or family grant; family phone null; `tripCountries`, `expiresAt`; `DEMO_ISSUER` export; no `DEMO_LIVE_PHONE` |
| `src/demo-phone.ts` (create) | `demoLimits(env)`, `CALLING_CODES`, `DEMO_PREFIX`, `zavuSender`, `demoPhoneRoutes` (start, verify), `purgeDemoWorlds` |
| `src/worker.ts` (modify) | Demo startup rules (budgets, pepper, text prefix); `demoDispatch(env)`; purge loop in `control` |
| `db/migrations/010-demo-phone-otp.sql` (create) | `demo_phone_challenges`, `demo_phone_verifications` |
| `web/src/lib/api/types.ts`, `web/src/lib/api/responses.ts` (modify) | `DemoWorld` and its decoder follow the new session response |
| `web/tests/api/runtime.test.mjs`, `web/tests/api/runtime.integration.mjs` (modify) | Fixtures without `truckId`/family `grantId` |
| `tests/web.test.mjs` (create) | Static serving, traversal, missing build, proxy hops, `TRUST_PROXY_HOPS` |
| `tests/demo-phone.test.mjs` (create) | Settings, OTP abuse cases, OTP allowlist, caps, worker pass-through, purge |
| `tests/infra.test.mjs`, `tests/provider.test.mjs`, `tests/dispatch.test.mjs`, `tests/checks.test.mjs`, `tests/demo.test.mjs`, `tests/client-read.test.mjs` (modify) | Docker, one-way SMS, wording and session expectations |
| `docs/contracts/runtime.md`, `docs/contracts/client-read.md`, `.env.example` (modify) | Contract, env vars (fictional values only) |

Plan B owns everything else under `web/`. This plan touches only the decoder lines and the two test fixtures that the session change breaks.

---

### Task 1: Serve `web/dist` with an SPA fallback, outside the auth hook

**Files:**
- Create: `src/api/web.ts`, `tests/web.test.mjs`
- Modify: `src/api/app.ts:15` (import), `:17-18` (option), after `:25` (hook), after `:46` (registration); `src/server.ts:1-14`

- [ ] **Step 1: Write the failing test.** Create `tests/web.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/runtime.mjs';

// A synthetic build shaped like web/dist (index.html, fingerprinted assets/, root files), with a secret just outside it.
function build(t) {
  const base = mkdtempSync(join(tmpdir(), 'andes-web-')); const root = join(base, 'dist');
  mkdirSync(join(root, 'assets'), {recursive: true});
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>SYNTHETIC app</title>');
  writeFileSync(join(root, 'assets', 'app-SYNTH.js'), 'export const synthetic = true;');
  writeFileSync(join(root, 'robots.txt'), 'User-agent: *');
  writeFileSync(join(base, 'secret.txt'), 'SYNTHETIC secret outside the build');
  t.after(() => rmSync(base, {recursive: true, force: true}));
  return root;
}
const get = (f, url) => f.app.inject({method: 'GET', url});

test('the app shell and its files load without a token; every /v1 path stays authenticated JSON', async t => {
  const f = await fixture(t, {webRoot: build(t)});
  for (const url of ['/', '/trips/11111111-1111-4111-8111-111111111111', '/contact/invitations/22222222-2222-4222-8222-222222222222?x=1']) {
    const r = await get(f, url);
    assert.equal(r.statusCode, 200, url); assert.match(r.headers['content-type'], /^text\/html/, url);
    assert.equal(r.body, '<!doctype html><title>SYNTHETIC app</title>', url); assert.equal(r.headers['cache-control'], 'no-store', url);
  }
  const asset = await get(f, '/assets/app-SYNTH.js');
  assert.equal(asset.statusCode, 200); assert.match(asset.headers['content-type'], /^text\/javascript/);
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  const robots = await get(f, '/robots.txt');
  assert.equal(robots.body, 'User-agent: *'); assert.equal(robots.headers['cache-control'], 'no-cache');
  for (const url of ['/assets/missing.js', '/index.php', '/assets/app-SYNTH.map']) {
    const r = await get(f, url); assert.equal(r.statusCode, 404, url); assert.deepEqual(r.json(), {code: 'not_found'}, url);
  }
  for (const url of ['/v1/me', '/v1/unknown', '/v1']) {
    const r = await get(f, url); assert.equal(r.statusCode, 401, url); assert.deepEqual(r.json(), {code: 'unauthorized'}, url);
  }
  assert.deepEqual(await f.req('GET', '/v1/unknown'), {status: 404, body: {code: 'not_found'}});
  assert.equal((await get(f, '/mapa')).statusCode, 200, 'existing public routes keep priority');
  assert.deepEqual((await get(f, '/health')).json(), {status: 'ok'});
});

test('paths that climb out of the build are refused, even unnormalized over real HTTP', async t => {
  const f = await fixture(t, {webRoot: build(t)});
  const origin = new URL(await f.app.listen({port: 0, host: '127.0.0.1'}));
  const raw = path => new Promise((resolve, reject) => http.get({host: origin.hostname, port: origin.port, path}, response => {
    let body = ''; response.setEncoding('utf8');
    response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve({status: response.statusCode, body}));
  }).on('error', reject));
  assert.equal((await raw('/robots.txt')).status, 200, 'positive control: raw requests reach the build');
  for (const path of ['/../secret.txt', '/assets/../../secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e/secret.txt', '/..\\secret.txt']) {
    const response = await raw(path);
    // 404 from our guard; the router may reject a malformed path with 400 first. Either way the secret never leaves.
    assert.ok([400, 404].includes(response.status), `${path}: ${response.status}`); assert.doesNotMatch(response.body, /SYNTHETIC secret/, path);
  }
});

test('without a web build the API refuses to start instead of serving 404s', async t => {
  const f = await fixture(t);
  const {createApp} = await import('../dist/api/app.js'); const {createContext} = await import('../dist/db.js');
  const ctx = createContext(f.ctx.pool.options.connectionString, f.ctx.clock);
  try {
    assert.throws(() => createApp({ctx, auth: {issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => { throw new Error('unused'); }},
      webRoot: join(tmpdir(), `andes-no-build-${process.pid}`)}), /index\.html/);
  } finally { await ctx.close(); }
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm run build && node --test tests/web.test.mjs`. Expected FAIL: the first test gets `401 !== 200` for `/` (the `webRoot` option is ignored, so the auth hook rejects it). The traversal test fails on its positive control (`401 !== 200`). The missing-build test fails with `Missing expected exception`.

- [ ] **Step 3: Implement.** Create `src/api/web.ts`:

```ts
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { problem } from '../contracts.js';
// Only what a Vite build of web/ emits; any other extension is refused.
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};
/** The web app's own routes: everything but the API. The auth hook skips these; every /v1 path stays authenticated. */
export function isWebRoute(request: FastifyRequest): boolean {
  return (request.routeOptions.url === '/' || request.routeOptions.url === '/*') && !/^\/v1(?:[/?]|$)/.test(request.url);
}
/** Serves the built web app from the API origin: real files by extension, index.html for every other app path. */
export function webRoutes(app: FastifyInstance, root: string) {
  const base = resolve(root);
  const index = readFileSync(join(base, 'index.html')); // read once: a missing build fails at startup
  async function serve(request: FastifyRequest, reply: FastifyReply) {
    const path = (request.params as { '*'?: string })['*'] ?? '';
    if (/^v1(?:\/|$)/.test(path)) problem(404, 'not_found');
    if (!extname(path)) return reply.type('text/html; charset=utf-8').send(index); // a client-side route
    const type = types[extname(path).toLowerCase()];
    const file = join(base, path);
    if (!type || path.includes('\0') || path.split(/[\\/]/).includes('..') || !file.startsWith(base + sep)) problem(404, 'not_found');
    const body = await readFile(file).catch(() => null);
    if (!body) problem(404, 'not_found');
    // Vite fingerprints everything under assets/; other files keep their names, so browsers revalidate them.
    reply.header('Cache-Control', path.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return reply.type(type).send(body);
  }
  app.get('/', serve);
  app.get('/*', serve);
}
```

In `src/api/app.ts`:
- After line 15 (`import { insightRoutes } from '../insights/routes.js';`) add:
```ts
import { isWebRoute, webRoutes } from './web.js';
```
- Replace the `export interface AppOptions …` and `export function createApp(…` lines (17-18) with:
```ts
export interface AppOptions { ctx: Context; auth: AuthConfig; channelSupport?: ChannelSupport[]; callbackConfig?: CallbackConfig; demo?: DemoIssuer; automaticChecks?: boolean; webRoot?: string }
export function createApp({ ctx, auth, channelSupport = [], callbackConfig, demo, automaticChecks = false, webRoot }: AppOptions) {
```
- After line 25 (the `/health`/`/mapa` exemption line) add:
```ts
    if (isWebRoute(request)) return; // the app shell and its files are public; every /v1 path stays authenticated
```
- After line 46 (`if (callbackConfig) callbackRoutes(app, ctx, callbackConfig);`) add:
```ts
  if (webRoot) webRoutes(app, webRoot);
```

In `src/server.ts`, add this as the new first line:
```ts
import { fileURLToPath } from 'node:url';
```
and replace lines 13-14 (the `createApp` call) with:
```ts
const app = createApp({ ctx, channelSupport: provider?.qualification.live ? provider.qualification.entries : [], callbackConfig, auth: demo?.auth ?? { issuer: OIDC_ISSUER!, audience: OIDC_AUDIENCE!, jwksUrl: OIDC_JWKS_URL! }, demo,
  automaticChecks: checkConfig(process.env) !== null, // same timings as the control worker
  webRoot: fileURLToPath(new URL('../web/dist', import.meta.url)) }); // build web/ first; a missing build fails here
```

- [ ] **Step 4: Run it and watch it pass.** Run `npm run build && node --test tests/web.test.mjs`. Expected: 3 passing. Then run `npm test`. Expected: everything passes (no other test passes `webRoot`).

- [ ] **Step 5: Commit.**
```bash
git add src/api/web.ts src/api/app.ts src/server.ts tests/web.test.mjs
git commit -m "feat(web): Serve the built web app from the API origin"
```

---

### Task 2: Trust exactly one proxy hop and make the listen host configurable

**Files:**
- Modify: `src/api/app.ts` (the `AppOptions`/`createApp` lines and the `Fastify(` line, 18-21 after Task 1), `src/server.ts` (after the imports; the `listen` line), `tests/web.test.mjs` (imports, two tests appended)

- [ ] **Step 1: Write the failing tests.** Add these imports at the top of `tests/web.test.mjs`:

```js
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateKeyPair, SignJWT} from 'jose';
```

Append:

```js
test('one trusted proxy hop: a client-forged X-Forwarded-For entry never becomes request.ip', async t => {
  const f = await fixture(t);
  const {createApp} = await import('../dist/api/app.js'); const {createContext} = await import('../dist/db.js');
  const {publicKey, privateKey} = await generateKeyPair('RS256');
  const token = await new SignJWT({}).setProtectedHeader({alg: 'RS256'}).setIssuer('https://synthetic.test').setAudience('andes-test')
    .setSubject('ip-probe').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  async function ipFor(hops, forwarded) {
    const app = createApp({ctx: createContext(f.ctx.pool.options.connectionString, f.ctx.clock),
      auth: {issuer: 'https://synthetic.test', audience: 'andes-test', keyResolver: async () => publicKey}, ...(hops === undefined ? {} : {trustProxyHops: hops})});
    app.get('/v1/test/ip', request => ({ip: request.ip}));
    try { return (await app.inject({method: 'GET', url: '/v1/test/ip', headers: {authorization: `Bearer ${token}`, 'x-forwarded-for': forwarded}})).json().ip; }
    finally { await app.close(); }
  }
  assert.equal(await ipFor(1, '198.51.100.7'), '198.51.100.7', 'the client the proxy saw');
  assert.equal(await ipFor(1, '203.0.113.9, 198.51.100.7'), '198.51.100.7', 'an entry the client wrote is ignored');
  assert.equal(await ipFor(undefined, '198.51.100.7'), '127.0.0.1', 'createApp trusts no proxy unless told');
  assert.equal(await ipFor(0, '198.51.100.7'), '127.0.0.1');
});

test('the server refuses a TRUST_PROXY_HOPS that is not a small integer', () => {
  const server = fileURLToPath(new URL('../dist/server.js', import.meta.url));
  for (const hops of ['true', '-1', '1.5', '4']) {
    const run = spawnSync(process.execPath, [server], {encoding: 'utf8', timeout: 20000, env: {PATH: process.env.PATH, DEMO_MODE: 'true', TRUST_PROXY_HOPS: hops}});
    assert.equal(run.status, 1, hops); assert.match(run.stderr, /TRUST_PROXY_HOPS must be an integer from 0 to 3/, hops);
  }
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/web.test.mjs`. Expected FAIL: `'127.0.0.1' !== '198.51.100.7'`. For the server test, stderr shows `Database URL or complete PostgreSQL components required` instead of the `TRUST_PROXY_HOPS` message.

- [ ] **Step 3: Implement.** In `src/api/app.ts` (after Task 1), change the options and the Fastify call:
- The `export interface AppOptions …` and `export function createApp(…` lines become:
```ts
export interface AppOptions { ctx: Context; auth: AuthConfig; channelSupport?: ChannelSupport[]; callbackConfig?: CallbackConfig; demo?: DemoIssuer; automaticChecks?: boolean; webRoot?: string; trustProxyHops?: number }
export function createApp({ ctx, auth, channelSupport = [], callbackConfig, demo, automaticChecks = false, webRoot, trustProxyHops = 0 }: AppOptions) {
```
- The `const app = Fastify({ … });` line becomes:
```ts
  // trustProxy: exactly this many proxies (0 = none), so request.ip is the address the nearest trusted proxy saw. Never `true`.
  const app = Fastify({ logger: false, trustProxy: trustProxyHops, bodyLimit: 128 * 1024, requestTimeout: 10000, ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } } });
```

In `src/server.ts`, insert after the line `const { OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL } = process.env;`:
```ts
// Exactly the proxies in front of the API: cloudflared locally, the ECS Express load balancer on AWS. Never `true`: any client could forge X-Forwarded-For.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 3) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 3');
```
In the `createApp({...})` call, change `webRoot: fileURLToPath(new URL('../web/dist', import.meta.url)) });` to `webRoot: fileURLToPath(new URL('../web/dist', import.meta.url)), trustProxyHops });`. Replace the `listen` line with:
```ts
// HOST=127.0.0.1 behind a local tunnel, so nobody on the LAN reaches the API directly and forges X-Forwarded-For.
try { await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' }); }
```

- [ ] **Step 4: Run them and watch them pass.** Run `npm run build && node --test tests/web.test.mjs tests/demo.test.mjs`. Expected: all pass, including `the real server entry stays off demo mode…`, because the default of 1 is valid.

- [ ] **Step 5: Commit.**
```bash
git add src/api/app.ts src/server.ts tests/web.test.mjs
git commit -m "feat(server): Trust exactly TRUST_PROXY_HOPS proxies and listen on HOST"
```

---

### Task 3: The Docker image builds and ships the web app

**Files:**
- Modify: `Dockerfile` (whole file), `.dockerignore:4-5`, `tests/infra.test.mjs:88`

- [ ] **Step 1: Write the failing test.** In `tests/infra.test.mjs`, after line 88 (`assert.match(text('.dockerignore'),/!infra\/rds-global-bundle\.pem/);`), add:

```js
  assert.match(docker,/COPY web \.\//);assert.match(docker,/RUN npm run build/);assert.match(docker,/COPY --from=web \/app\/web\/dist \.\/web\/dist/);
  // Host node_modules (macOS binaries) must never overwrite the image's own install.
  assert.match(text('.dockerignore'),/^\*\*\/node_modules$/m);assert.match(text('.dockerignore'),/^\*\*\/dist$/m);
```

- [ ] **Step 2: Run it and watch it fail.** Run `node --test tests/infra.test.mjs`. Expected FAIL: `The input did not match the regular expression /COPY web \.\//`.

- [ ] **Step 3: Implement.** Replace `Dockerfile` with:

```Dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# The web app, served by the API from the same origin (src/api/web.ts).
FROM node:24-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
# The spec's GPS adapter lives in the backend tree; keep its relative path for the web's Vite alias.
COPY src/phone-observations /app/src/phone-observations
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=web /app/web/dist ./web/dist
COPY package.json package-lock.json ./
COPY db ./db
COPY public ./public
COPY scripts/migrate.mjs scripts/bootstrap.mjs scripts/seed-demo.mjs ./scripts/
COPY infra/rds-global-bundle.pem ./infra/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

In `.dockerignore`, replace line 4 (`node_modules`) with `**/node_modules` and line 5 (`dist`) with `**/dist`.

- [ ] **Step 4: Run it and watch it pass.** Run `node --test tests/infra.test.mjs`. Expected: pass. If Docker is available, also run `docker build --platform linux/amd64 -t andes-backend:plan-a .`. Expected: the build succeeds and `docker run --rm andes-backend:plan-a ls web/dist` lists `index.html` and `assets`. CI runs the same build.

- [ ] **Step 5: Commit.**
```bash
git add Dockerfile .dockerignore tests/infra.test.mjs
git commit -m "build(docker): Build web/ into the image"
```

---

### Task 4: Zavu one-way SMS sender (`smsMode: 'oneway'`): send, send reply, read-back and callbacks

**Files:**
- Modify: `src/notifications/zavu.ts:6-15` (types), `:26` (channel lists), `:39` (validation), `:56` (`accepted`), `:69` (`payload`), `:98` (`read`), `:122-123` (`verifyCallback`), plus a new `textPayload` export
- Test: `tests/provider.test.mjs:3` and one appended test; `tests/dispatch.test.mjs`, one appended integration test

- [ ] **Step 1: Write the failing unit test.** In `tests/provider.test.mjs`, replace line 3 (`import { createHmac } from 'node:crypto';`) with `import { createHash, createHmac } from 'node:crypto';` and append:

```js
test('a one-way SMS sender: internal sms goes out and reads back as sms_oneway, and callbacks map it to sms', async () => {
  const {createZavuProvider, verifyCallback, textPayload, loadQualification} = await api();
  const oneway = {...qualification, smsMode: 'oneway'};
  const sent = [];
  const reply = (channel, status) => new Response(JSON.stringify({message: {id: 'msg_oneway', channel, to: input.to, status: 'queued', direction: 'outbound'}}), {status});
  const p = createZavuProvider(oneway, 'fixture-key', async (_url, init) => {
    if (init.method === 'POST') { sent.push(JSON.parse(init.body)); return reply(sent.at(-1).channel, 202); }
    return reply('sms_oneway', 200);
  });
  const payload = p.payload(input);
  assert.equal(payload.channel, 'sms_oneway'); assert.equal(payload.idempotencyKey, 'andes:attempt-fixture:sms');
  assert.equal((await p.send(payload)).state, 'accepted', 'the send reply says sms_oneway'); assert.equal(sent[0].channel, 'sms_oneway');
  assert.equal(p.payload({...input, channel: 'whatsapp'}).channel, 'whatsapp', 'only sms has a one-way form');
  const destinationHash = createHash('sha256').update(input.to).digest('hex');
  assert.equal((await p.read('msg_oneway', undefined, {channel: 'sms', destinationHash})).state, 'accepted', 'read-back');
  const twoWay = createZavuProvider(qualification, 'fixture-key', async () => reply('sms_oneway', 200));
  assert.equal(twoWay.payload(input).channel, 'sms');
  assert.equal((await twoWay.read('msg_oneway', undefined, {channel: 'sms', destinationHash})).state, 'unknown', 'a two-way account never accepts the one-way form');
  assert.deepEqual(textPayload(oneway, input.to, 'Demo de Tándem: tu código es 123456', 'otp-fixture'), {to: input.to, channel: 'sms_oneway', messageType: 'text',
    text: 'Demo de Tándem: tu código es 123456', fallbackEnabled: false, idempotencyKey: 'andes:otp:otp-fixture', metadata: {attemptId: 'otp-fixture'}});
  const config = {projectId: 'prj_fixture', senderId: 'snd_fixture', secret: 'fixture-secret-not-a-credential'};
  const signed = channel => {
    const raw = Buffer.from(JSON.stringify({id: 'evt_oneway', type: 'message.delivered', timestamp: 1792238400000, senderId: 'snd_fixture', projectId: 'prj_fixture',
      data: {messageId: 'msg_oneway', to: input.to, channel, status: 'delivered'}}));
    return [raw, `t=1792238400,v2=${createHmac('sha256', config.secret).update('1792238400.').update(raw).digest('hex')}`];
  };
  assert.equal(verifyCallback(...signed('sms_oneway'), config, new Date(1792238400000)).data.channel, 'sms', 'callback');
  assert.throws(() => verifyCallback(...signed('sms_twoway'), config, new Date(1792238400000)), /invalid_callback/);
  const retained = {...qualification, evidence: 'test-only syntheticfixture: retained', entries: qualification.entries.map(e => ({...e, evidence: 'test-only syntheticfixture: channel'}))};
  assert.equal(loadQualification({ZAVU_QUALIFICATION_JSON: JSON.stringify({...retained, smsMode: 'oneway'})}).smsMode, 'oneway');
  assert.throws(() => loadQualification({ZAVU_QUALIFICATION_JSON: JSON.stringify({...retained, smsMode: 'twoway'})}), /qualification/);
});
```

- [ ] **Step 2: Write the failing end-to-end test.** Append to `tests/dispatch.test.mjs`. Today a signed `sms_oneway` callback gets a 401:

```js
test('a one-way SMS sender: the sms_oneway send reply, read-back and signed callback all land on the internal sms attempt', async t => {
  const config={projectId:'prj_fixture',senderId:'snd_fixture',secret:'syntheticfixture-callback-secret'};
  const d=await runtime();const f=await fixture(t,{callbackConfig:config});const {jobs}=await sos(f);
  const {createZavuProvider}=await import('../dist/notifications/zavu.js');
  const posted=[];
  const p=createZavuProvider({...qualification,smsMode:'oneway'},'syntheticfixture-key',async(_url,init)=>{
    if(init.method==='POST')posted.push(JSON.parse(init.body));
    return new Response(JSON.stringify({message:{id:'msg_oneway',channel:'sms_oneway',to:'+15555550100',status:init.method==='POST'?'queued':'sent',direction:'outbound'}}),{status:init.method==='POST'?202:200});
  });
  const sms=jobs.find(j=>j.channel==='sms');
  await d.runJob(f.ctx,sms,p,'oneway');
  assert.equal(posted[0].channel,'sms_oneway');
  const attempt=async()=>(await f.ctx.pool.query('SELECT channel,state,provider_message_id,delivery_status FROM dispatch_attempts WHERE job_id=$1',[sms.id])).rows[0];
  assert.deepEqual(await attempt(),{channel:'sms',state:'accepted',provider_message_id:'msg_oneway',delivery_status:'queued'},'send reply');
  f.advance(60001);assert.equal(await d.reconcileOnce(f.ctx,p,undefined,'sms'),true);
  assert.equal((await attempt()).delivery_status,'sent','read-back');
  const stamp=Math.floor(f.ctx.clock().getTime()/1000);
  const raw=Buffer.from(JSON.stringify({id:'evt_oneway_1',type:'message.delivered',timestamp:stamp*1000,senderId:'snd_fixture',projectId:'prj_fixture',
    data:{messageId:'msg_oneway',to:'+15555550100',channel:'sms_oneway',status:'delivered'}}));
  const signature=`t=${stamp},v2=${createHmac('sha256',config.secret).update(`${stamp}.`).update(raw).digest('hex')}`;
  const callback=await f.app.inject({method:'POST',url:'/v1/callbacks/zavu',headers:{'content-type':'application/json','x-zavu-signature':signature},payload:raw});
  assert.equal(callback.statusCode,200,'callback');
  assert.deepEqual((await f.ctx.pool.query('SELECT channel,disposition FROM provider_events')).rows,[{channel:'sms',disposition:'applied'}]);
  assert.equal((await attempt()).delivery_status,'delivered');
});
```

- [ ] **Step 3: Run them and watch them fail.** Run `npm run build && node --test tests/provider.test.mjs tests/dispatch.test.mjs`. Expected FAIL: `'sms' !== 'sms_oneway'` in both new tests. The other tests pass.

- [ ] **Step 4: Implement.** In `src/notifications/zavu.ts`:
- In `Qualification` (lines 6-13), after the `demoLimits?` line, add:
```ts
  /** Optional: 'oneway' when the account's SMS sender is Zavu's one-way kind. Internal 'sms' then goes out and reads back as 'sms_oneway'. */
  smsMode?: 'oneway';
```
- Line 15, in `Payload`, change `channel: Channel;` to `channel: Channel | 'sms_oneway';`.
- After line 26 (`const channels = ['sms', 'whatsapp', 'voice'];`) add:
```ts
const providerChannels = [...channels, 'sms_oneway'];
/** The name Zavu uses on this account for an internal channel. */
const wire = (q: Qualification, channel: Channel): Payload['channel'] => channel === 'sms' && q.smsMode === 'oneway' ? 'sms_oneway' : channel;
```
- After line 39 (the `demoLimits` validation) add:
```ts
    if (q.smsMode !== undefined && q.smsMode !== 'oneway') throw Error();
```
- Line 56, in `accepted()`, change `!channels.includes(String(m.channel))` to `!providerChannels.includes(String(m.channel))`. The `expected` comparison against the payload's wire channel stays as it is.
- Line 69, in `payload()`, change `const base = { to: input.to, channel: input.channel, fallbackEnabled: false as const,` to `const base = { to: input.to, channel: wire(qualification, input.channel), fallbackEnabled: false as const,`.
- Line 98, in `read()`, change `message?.channel !== expected.channel` to `message?.channel !== wire(qualification, expected.channel)`.
- In `verifyCallback`, between line 122 (`try { event = JSON.parse(...) } catch { return fail(); }`) and line 123 (the validation `if`), insert:
```ts
  // The one-way SMS sender reports 'sms_oneway': that is internal 'sms'. Correlation still needs the exact message ID, sender and destination.
  const data = (event! as { data?: { channel?: unknown } } | null)?.data;
  if (data?.channel === 'sms_oneway') data.channel = 'sms';
```
- After `createZavuProvider` (before `export function verifyCallback`), add:
```ts
/** A plain SMS outside alert qualification (demo codes), on the account's SMS channel name. */
export function textPayload(qualification: Qualification, to: string, text: string, id: string): Payload {
  return { to, channel: wire(qualification, 'sms'), messageType: 'text', text, fallbackEnabled: false, idempotencyKey: `andes:otp:${id}`, metadata: { attemptId: id } };
}
```

- [ ] **Step 5: Run them and watch them pass.** Run `npm run build && node --test tests/provider.test.mjs tests/dispatch.test.mjs`. Expected: all pass. Then run `npm run typecheck`. Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add src/notifications/zavu.ts tests/provider.test.mjs tests/dispatch.test.mjs
git commit -m "feat(zavu): Send and track internal SMS on a one-way sender as sms_oneway"
```

---

### Task 5: Alert wording with no URLs in SMS and no IDs in calls

Zavu holds an SMS until each exact URL in it is pre-verified through `/v1/urls`, and it blocks URL shorteners. Every alert link is unique (Maps coordinates, incident view), so an alert SMS with a link would stall in `pending_url_verification`. A call would read a UUID aloud.

**Files:**
- Modify: `src/notifications/wording.ts` (whole file), `src/notifications/dispatch.ts:123`, `tests/checks.test.mjs:181-198`, `tests/dispatch.test.mjs:15` and `:39`

- [ ] **Step 1: Write the failing tests.** In `tests/checks.test.mjs`, replace lines 181-198 (the test `alert wording names the truck, keeps the incident ID and never invents location`) with:

```js
test('alert wording names the truck and never invents location; SMS carries no URL and calls read no ID', async () => {
  const {alertSummary} = await import('../dist/notifications/wording.js');
  const now = new Date('2026-10-17T12:05:00Z');
  const base = {truck: 'ABC-123', country: 'PE', timeZone: 'America/Lima', now, signalAt: null, channel: 'whatsapp',
    location: {latitude: -12.1, longitude: -77.03, accuracy: 18.4, captured_at: new Date('2026-10-17T12:02:00Z')}};
  const env = {EMERGENCY_NUMBERS: '{"PE":"105"}', CONTACT_APP_URL: 'https://andes.example'};
  assert.equal(alertSummary({...base, incident: {id: 'i-1', trigger: 'sos', check_reason: null}}, env),
    'ALERTA: el conductor del camión ABC-123 pidió ayuda (posible robo). Incidente i-1. Última ubicación a las 07:02 (hace 3 min, ±18 m): https://maps.google.com/?q=-12.1,-77.03. Llámalo. Si no responde, llama al 105. Ver: https://andes.example/incidents/i-1');
  assert.equal(alertSummary({...base, location: null, signalAt: new Date('2026-10-17T11:58:00Z'), incident: {id: 'i-2', trigger: 'missed_check', check_reason: 'silence'}}, {}),
    'el conductor del camión ABC-123 no confirmó su estado (sin señal desde 06:58). Incidente i-2. Última ubicación no disponible. No sabemos qué pasó. Llámalo.');
  assert.match(alertSummary({...base, incident: {id: 'i-3', trigger: 'missed_check', check_reason: 'arrival_overdue'}}, env), /no llegó a la hora prevista\). Incidente i-3\..*Llámalo; si no responde, llama al 105\./);
  assert.match(alertSummary({...base, incident: {id: 'i-4', trigger: 'missed_check', check_reason: 'sharing_stopped'}}, {}), /dejó de compartir su ubicación/);
  assert.match(alertSummary({...base, location: {...base.location, captured_at: new Date('2026-10-17T10:00:00Z')}, incident: {id: 'i-5', trigger: 'sos', check_reason: null}}, {}), /hace 2 h 5 min/);
  assert.match(alertSummary({...base, truck: 'ABC\n123\t'.padEnd(80, 'x'), incident: {id: 'i-6', trigger: 'sos', check_reason: null}}, {}), /camión ABC 123 x{32} pidió/);
  // SMS: Zavu holds an SMS until each exact URL is verified, and every alert link is unique, so coordinates are plain text.
  const texted = alertSummary({...base, channel: 'sms', incident: {id: 'i-8', trigger: 'sos', check_reason: null}}, env);
  assert.equal(texted, 'ALERTA: el conductor del camión ABC-123 pidió ayuda (posible robo). Incidente i-8. Última ubicación a las 07:02 (hace 3 min, ±18 m): -12.1, -77.03. Llámalo. Si no responde, llama al 105.');
  assert.doesNotMatch(texted, /http|www\.|\.com/);
  assert.doesNotMatch(alertSummary({...base, channel: 'sms', incident: {id: 'i-9', trigger: 'missed_check', check_reason: 'silence'}}, env), /http/);
  // Voice: a call never reads a URL or an ID aloud.
  const uuid = '0d3c2a9e-1b7f-4c55-9a51-3f1e2d4c5b6a';
  const spoken = alertSummary({...base, channel: 'voice', incident: {id: uuid, trigger: 'sos', check_reason: null}}, env);
  assert.equal(spoken, 'ALERTA: el conductor del camión ABC-123 pidió ayuda (posible robo). Última ubicación a las 07:02, hace 3 min, precisión de 18 metros. Llámalo. Si no responde, llama al 105.');
  assert.equal(alertSummary({...base, channel: 'voice', location: null, signalAt: new Date('2026-10-17T11:58:00Z'), incident: {id: uuid, trigger: 'missed_check', check_reason: 'silence'}}, {}),
    'el conductor del camión ABC-123 no confirmó su estado (sin señal desde 06:58). Última ubicación no disponible. No sabemos qué pasó. Llámalo.');
});
```

In `tests/dispatch.test.mjs`, first replace line 39 as shown below, then after line 15 (`assert.ok(match,'recipient-facing summary must identify the exact incident');`) add:

```js
  // The frozen SMS has map access, so it carries the coordinates as plain text and no URL at all.
  assert.match(frozen.text,/±7 m\): -12, -77\. Llámalo\./);assert.doesNotMatch(frozen.text,/http/,'Zavu holds SMS with unverified URLs');
```

Line 39 (`    assert.ok(summary.includes(`Incidente ${id}.`));assert.match(summary,/ubicación no disponible/);assert.doesNotMatch(summary,/maps\.google\.com/);`) becomes:

```js
    if(job.channel==='voice')assert.doesNotMatch(summary,/Incidente|[0-9a-f]{8}-[0-9a-f]{4}-/,'a call never reads an ID aloud');
    else assert.ok(summary.includes(`Incidente ${id}.`));
    assert.match(summary,/ubicación no disponible/);assert.doesNotMatch(summary,/maps\.google\.com/);
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/checks.test.mjs tests/dispatch.test.mjs`. Expected FAIL: `texted` still contains `https://maps.google.com/?q=-12.1,-77.03`, the frozen SMS still holds the Maps link, and the voice summary still contains `Incidente`.

- [ ] **Step 3: Implement.** Replace `src/notifications/wording.ts` with:

```ts
import type { Channel } from '../contracts.js';
interface AlertInput {
  truck: string; country: string; timeZone: string; now: Date; signalAt: Date | null; channel: Channel;
  incident: { id: string; trigger: string; check_reason: string | null } | null;
  location: { latitude: number; longitude: number; accuracy: number; captured_at: Date } | null;
}
function age(ms: number) {
  const minutes = Math.round(Math.max(0, ms) / 60000);
  if (minutes < 1) return `${Math.round(Math.max(0, ms) / 1000)} s`;
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
function emergencyNumber(country: string, env: NodeJS.ProcessEnv): string | null {
  try { const number = JSON.parse(env.EMERGENCY_NUMBERS ?? '{}')[country]; return typeof number === 'string' && /^\d{2,15}$/.test(number) ? number : null; }
  catch { return null; }
}
/** Spanish-only for the demo, pt-BR trips included. ponytail: add pt-BR summaries when a Brazilian corridor is tested. */
export function alertSummary(input: AlertInput, env: NodeJS.ProcessEnv = process.env): string {
  const { incident, location, now, channel } = input;
  // The truck label is driver free text: one line, bounded, so templates and SMS stay valid.
  const truck = input.truck.replace(/\s+/g, ' ').trim().slice(0, 40);
  const clock = (at: Date) => new Intl.DateTimeFormat('es', { timeZone: input.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  const ago = location ? age(now.getTime() - location.captured_at.getTime()) : '';
  // The capture time (trip time zone) stays true however late the message is read; the age is relative to authorization.
  const at = location ? clock(location.captured_at) : '';
  // SMS carries no URL: Zavu holds an SMS until each exact URL is verified, and every alert link is unique. A call would read
  // a URL or a UUID aloud, so voice gets time, age and accuracy, and no incident ID. WhatsApp keeps both links.
  const where = !location ? 'Última ubicación no disponible.'
    : channel === 'voice' ? `Última ubicación a las ${at}, hace ${ago}, precisión de ${Math.round(location.accuracy)} metros.`
    : `Última ubicación a las ${at} (hace ${ago}, ±${Math.round(location.accuracy)} m): ${channel === 'sms' ? `${location.latitude}, ${location.longitude}` : `https://maps.google.com/?q=${location.latitude},${location.longitude}`}.`;
  const emergency = emergencyNumber(input.country, env);
  const id = incident && channel !== 'voice' ? ` Incidente ${incident.id}.` : '';
  const view = incident && env.CONTACT_APP_URL && channel === 'whatsapp' ? ` Ver: ${env.CONTACT_APP_URL}/incidents/${incident.id}` : '';
  if (incident?.trigger === 'sos') return `ALERTA: el conductor del camión ${truck} pidió ayuda (posible robo).${id} ${where} Llámalo.${emergency ? ` Si no responde, llama al ${emergency}.` : ''}${view}`;
  const local = input.signalAt ? clock(input.signalAt) : null;
  const reason = ({ arrival_overdue: 'no llegó a la hora prevista', silence: `sin señal desde ${local ?? 'hace un rato'}`, sharing_stopped: 'dejó de compartir su ubicación' } as Record<string, string>)[incident?.check_reason ?? ''];
  return `el conductor del camión ${truck} no confirmó su estado${reason ? ` (${reason})` : ''}.${id} ${where} No sabemos qué pasó. Llámalo${emergency ? `; si no responde, llama al ${emergency}` : ''}.${view}`;
}
```

In `src/notifications/dispatch.ts`, line 123, change `location: location ?? null, voice: job.channel === 'voice' });` to `location: location ?? null, channel: job.channel });`.

- [ ] **Step 4: Run them and watch them pass.** Run `npm run build && node --test tests/checks.test.mjs tests/dispatch.test.mjs`. Expected: all pass. Then run `npm test`. Expected: all pass. The `ANDES: estado sin confirmar.` SMS assertion at `tests/checks.test.mjs:97` still holds, because SMS keeps the incident ID.

- [ ] **Step 5: Commit.**
```bash
git add src/notifications/wording.ts src/notifications/dispatch.ts tests/checks.test.mjs tests/dispatch.test.mjs
git commit -m "fix(alerts): Keep URLs out of SMS and IDs out of calls"
```

---

### Task 6: Demo session without a truck or a family grant

**Files:**
- Modify: `src/demo.ts` (whole file); `tests/demo.test.mjs:17-45,67-73,144-167,186-234`; `tests/client-read.test.mjs:190-207,430-453`; `web/src/lib/api/types.ts:70-75`; `web/src/lib/api/responses.ts:104-106`; `web/tests/api/runtime.test.mjs:16-20,143,161-162`; `web/tests/api/runtime.integration.mjs:91-98,127`

- [ ] **Step 1: Write the failing backend tests.** Apply these edits to `tests/demo.test.mjs` **from the bottom up**, so the line numbers stay valid:

(a) Delete lines 213-234, the test `with phone-less tokens the live demo journey still runs…`. Task 10 replaces it with the OTP-verified journey.

(b) Replace lines 186-211 (the `consented` constant, `liveDemo` and the test `the anonymous demo session never hands out a phone…`) with:

```js
test('the anonymous demo session never hands out a phone: no phone claim in any token, no number in the body', async t => {
  const {f} = await demoFixture(t);
  const response = await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}});
  assert.equal(response.statusCode, 200);
  const e164 = /\+[1-9]\d{6,14}/;
  assert.doesNotMatch(response.body, e164); assert.ok(!response.body.includes('5555550103'), 'seeded digits in the body');
  const world = response.json();
  for (const persona of ['driver', 'family', 'colleague']) {
    for (const part of world[persona].token.split('.').slice(0, 2)) {
      const decoded = Buffer.from(part, 'base64url').toString('utf8'), claims = JSON.parse(decoded);
      assert.ok(!('phone_number' in claims) && !('phone_number_verified' in claims), `${persona} token carries a phone claim`);
      assert.doesNotMatch(decoded, e164, persona);
    }
  }
  // A phone-less token never gives the family persona a number: only the SMS code flow does.
  assert.equal((await f.req('GET', '/v1/me', undefined, world.family.token)).body.id, world.family.id);
  assert.deepEqual((await f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [world.family.id])).rows, [{phone: null, phone_verified: false}]);
});
```

(c) Replace lines 144-167 (`demoChecks`, `demoTrip`, `incidentJobs` and the test `in demo mode an abandoned trip…`) with:

```js
const demoChecks = {...cfg, demo: true};
// Sessions bring no truck and no family grant: a trip uses a truck made here and the seeded colleague grant.
async function demoTrip(f, world) {
  const truck = (await f.req('POST', '/v1/trucks', {label: 'SYNTHETIC demo truck'}, world.driver.token)).body.id;
  const draft = await f.req('POST', '/v1/trip-drafts', {text: 'SYNTHETIC demo trip', fields: {truckId: truck, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}}, world.driver.token);
  return (await f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [world.colleague.grantId]}, world.driver.token)).body.id;
}
const incidentJobs = async (f, trip) => (await f.ctx.pool.query("SELECT count(*)::int n FROM jobs WHERE trip_id=$1 AND channel<>'group'", [trip])).rows[0].n;

test('in demo mode an abandoned trip opens no check and alerts nobody; a watched trip still escalates; SOS always works', async t => {
  const {f, session} = await demoFixture(t);
  const watched = (await session()).body; const left = (await session()).body;
  const watchedTrip = await demoTrip(f, watched); const leftTrip = await demoTrip(f, left);
  const poll = () => f.req('GET', `/v1/trips/${watchedTrip}/status`, undefined, watched.colleague.token);
  f.advance(120001); await poll(); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, watchedTrip), [asking('silence')]);
  assert.deepEqual(await checksOf(f, leftTrip), [], 'nobody has looked at this world for longer than the ask window');
  f.advance(60000); await poll(); await sweep(f, demoChecks);
  assert.equal((await checksOf(f, watchedTrip))[0].status, 'escalated');
  assert.equal(await incidentJobs(f, watchedTrip), 2);
  f.advance(3600000); await sweep(f, demoChecks); await sweep(f, demoChecks);
  assert.deepEqual(await checksOf(f, leftTrip), []);
  assert.equal(await incidentJobs(f, leftTrip), 0);
  assert.equal((await f.req('POST', `/v1/trips/${leftTrip}/sos`, {}, left.driver.token)).status, 200, 'an explicit SOS is never suppressed');
  assert.equal(await incidentJobs(f, leftTrip), 2);
});
```

(d) Replace lines 67-73 (the test title through `assert.deepEqual(phones, …);`) with this one line. Task 10 rewrites the rest of this test:

```js
test('live demo provider startup requires the consented allowlist and a budget', async () => {
```

(e) Replace lines 36-45 (the test `demo sessions are rate limited, and live sends need the consented DEMO_LIVE_PHONE`) with:

```js
test('demo sessions are rate limited', async t => {
  const {f, session} = await demoFixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await session()).status, 200);
  assert.deepEqual(await session(), {status: 429, body: {code: 'demo_rate_limited'}});
  f.advance(60001);
  assert.equal((await session()).status, 200);
});
```

(f) Replace lines 17-34 (the test `a demo session creates an isolated synthetic world…`) with:

```js
test('a demo session starts a world with no truck and no family grant, which its personas build from scratch', async t => {
  const {f, session} = await demoFixture(t);
  const world = await session();
  assert.equal(world.status, 200);
  const {driver, family, colleague} = world.body;
  assert.deepEqual(Object.keys(world.body).sort(), ['colleague', 'driver', 'expiresAt', 'expiresInSeconds', 'family', 'synthetic', 'tripCountries']);
  assert.deepEqual([Object.keys(driver).sort(), Object.keys(family).sort(), Object.keys(colleague).sort()], [['id', 'token'], ['id', 'token'], ['grantId', 'id', 'token']]);
  assert.equal(world.body.synthetic, true); assert.deepEqual(world.body.tripCountries, []);
  const left = Date.parse(world.body.expiresAt) - Date.now();
  assert.ok(left > 7_190_000 && left <= 7_200_000, 'expiresAt is when the tokens expire');
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int n FROM trucks')).rows[0].n, 0);
  assert.deepEqual((await f.ctx.pool.query('SELECT id,role,phone,accepted_at IS NOT NULL AS accepted FROM contact_grants')).rows,
    [{id: colleague.grantId, role: 'colleague', phone: '+15555550103', accepted: true}]);
  assert.deepEqual((await f.ctx.pool.query('SELECT id,phone,phone_verified FROM identities WHERE id=ANY($1) ORDER BY phone NULLS FIRST', [[driver.id, family.id, colleague.id]])).rows,
    [{id: family.id, phone: null, phone_verified: false}, {id: driver.id, phone: '+15555550101', phone_verified: true}, {id: colleague.id, phone: '+15555550103', phone_verified: true}]);
  assert.equal((await f.req('GET', '/v1/me', undefined, driver.token)).body.id, driver.id);
  const trip = await demoTrip(f, world.body);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, colleague.token)).status, 200);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, family.token)).status, 403, 'no family grant until the journey creates one');
  assert.equal((await f.req('POST', `/v1/trips/${trip}/sos`, {}, driver.token)).status, 200);
  assert.deepEqual((await f.ctx.pool.query('SELECT cg.role,count(*)::int n FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id GROUP BY cg.role')).rows, [{role: 'colleague', n: 2}]);
  const other = (await session()).body;
  assert.notEqual(other.driver.id, driver.id);
  assert.equal((await f.req('GET', `/v1/trips/${trip}/snapshot`, undefined, other.colleague.token)).status, 403);
});

test('tripCountries lists the countries with Zavu qualification entries, live or not', async t => {
  const {demoIssuer} = await import('../dist/demo.js');
  const entries = [...qualification.entries, {channel: 'sms', country: 'PE', locale: 'es-PE', text: 'Demo de Tándem: estado sin confirmar.'}]
    .map(e => ({...e, evidence: 'test-only syntheticfixture: channel'}));
  const json = JSON.stringify({...qualification, evidence: 'test-only syntheticfixture: retained', entries});
  for (const live of ['false', 'true']) {
    const demo = await demoIssuer({ZAVU_LIVE_SEND: live, ZAVU_QUALIFICATION_JSON: json});
    const f = await fixture(t, {auth: demo.auth, demo});
    assert.deepEqual((await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).json().tripCountries, ['BR', 'PE'], live);
  }
});
```

In `tests/client-read.test.mjs`, again bottom up:

Replace lines 430-453 (the test `actual demo sessions never disclose the configured live destination in catalogs`) with:

```js
test('actual demo sessions never disclose an invited family number in catalogs', async t => {
  const { demoIssuer } = await import('../dist/demo.js');
  // A fictional stand-in for the number a driver types in for the family contact.
  const familyPhone = '+15555550123';
  const demo = await demoIssuer({});
  const f = await fixture(t, { auth: demo.auth, demo });
  const session = await f.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} });
  assert.equal(session.statusCode, 200);
  const world = session.json();
  assert.equal((await f.req('POST', '/v1/contacts', { contactId: world.family.id, phone: familyPhone, map: true, incident: true }, world.driver.token)).status, 200);
  const stored = (await f.ctx.pool.query('SELECT phone FROM identities WHERE phone IS NOT NULL UNION SELECT phone FROM contact_grants')).rows.map(row => row.phone);
  assert.ok(stored.includes(familyPhone), 'positive control: the invited number is actually stored');
  for (const persona of [world.driver, world.family, world.colleague]) {
    for (const path of ['/v1/profile', '/v1/bootstrap', '/v1/trucks', '/v1/contacts', '/v1/trips']) {
      const response = await f.req('GET', path, undefined, persona.token);
      assert.equal(response.status, 200, path);
      const body = JSON.stringify(response.body);
      assert.ok(!body.includes('"phone":'), path);
      for (const phone of stored) assert.ok(!body.includes(phone), path);
    }
  }
  const contacts = (await f.req('GET', '/v1/contacts', undefined, world.driver.token)).body.contacts;
  assert.deepEqual(contacts.map(row => row.role).sort(), ['colleague', 'family']);
  assert.equal((await f.ctx.pool.query('SELECT count(*)::int AS n FROM dispatch_attempts')).rows[0].n, 0);
});
```

Replace lines 190-207 (the comment and the test `anonymous demo personas never read a phone, including DEMO_LIVE_PHONE, from any catalog`) with:

```js
// Gatekeeper item 1 repro: demo mode lets any anonymous visitor mint personas; the family number a driver types in
// (a fictional stand-in here) must never come back from a catalog.
test('anonymous demo personas never read a phone, including the invited family number, from any catalog', async t => {
  const { demoIssuer } = await import('../dist/demo.js');
  const demo = await demoIssuer({});
  const f = await fixture(t, { auth: demo.auth, demo });
  const world = (await f.app.inject({ method: 'POST', url: '/v1/demo/session', payload: {} })).json();
  const invite = await f.req('POST', '/v1/contacts', { contactId: world.family.id, phone: '+15555550123', map: true, incident: true }, world.driver.token);
  assert.equal(invite.status, 200);
  for (const persona of ['driver', 'family', 'colleague']) {
    for (const path of CATALOGS) {
      const response = await f.req('GET', path, undefined, world[persona].token);
      assert.equal(response.status, 200, `${persona} ${path}`);
      assertNoPhone(response.body, `${persona} ${path}`);
    }
  }
  const contacts = (await f.req('GET', '/v1/contacts', undefined, world.driver.token)).body.contacts;
  assert.deepEqual(contacts.map(c => [c.id, c.role, c.status]).sort(), [
    [world.colleague.grantId, 'colleague', 'accepted'], [invite.body.id, 'family', 'pending']].sort());
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/demo.test.mjs tests/client-read.test.mjs`. Expected FAIL: the key list still has `truckId` on `driver` and `grantId` on `family`, there is no `tripCountries` or `expiresAt`, `trucks` holds 1 row, and `family` has `phone: '+15555550102'`.

- [ ] **Step 3: Implement the backend.** Replace `src/demo.ts` with:

```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair, SignJWT } from 'jose';
import type { AuthConfig } from './auth.js';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { empty } from './api/schemas.js';
import { loadQualification } from './notifications/zavu.js';
export interface DemoIssuer { auth: AuthConfig; tripCountries: string[]; sign(subject: string, expiresAt: number): Promise<string> }
const issuer = 'https://demo.andes.invalid', audience = 'andes-demo', LIFETIME_SECONDS = 7200;
// Fictional +1-555-01xx numbers. The family persona has none: its contact verifies their own number by SMS code
// (POST /v1/demo/phone/verify), the only way a demo persona gets a number dispatch accepts.
const synthetic = { driver: '+15555550101', family: null, colleague: '+15555550103' } as const;
type Persona = keyof typeof synthetic;
/** ponytail: in-memory key; tokens die on restart and the demo must run one instance. */
export async function demoIssuer(env: NodeJS.ProcessEnv): Promise<DemoIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  return {
    auth: { issuer, audience, keyResolver: async () => publicKey, presence: true },
    // The trip form offers only countries with Zavu channel entries, live or not. DEMO_ALLOWED_COUNTRIES is about codes.
    tripCountries: [...new Set(loadQualification(env)?.entries.map(entry => entry.country) ?? [])].sort(),
    // The session route is anonymous: tokens carry no phone claim.
    sign: (subject, expiresAt) => new SignJWT({}).setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime(expiresAt).sign(privateKey)
  };
}
export function demoRoutes(app: FastifyInstance, ctx: Context, demo: DemoIssuer) {
  // Personas invite only within their own world, so worlds cannot pool a verified number onto one trip.
  app.addHook('preHandler', async request => {
    if (request.method !== 'POST' || request.routeOptions.url !== '/v1/contacts') return;
    const worlds = (await ctx.pool.query("SELECT count(DISTINCT split_part(subject,':',1))::int AS n FROM identities WHERE id IN ($1,$2)", [request.actor.id, (request.body as { contactId: string }).contactId])).rows[0].n;
    if (worlds > 1) problem(403, 'demo_world_boundary');
  });
  let windowStart = 0, created = 0;
  app.post('/v1/demo/session', { schema: { body: empty } }, async () => {
    const now = ctx.clock().getTime();
    if (now - windowStart > 60000) { windowStart = now; created = 0; }
    // ponytail: one global limit for a single demo instance; per-client limits if this outlives the event.
    if (++created > 30) problem(429, 'demo_rate_limited');
    const world = randomUUID();
    const ids: Record<Persona, string> = { driver: randomUUID(), family: randomUUID(), colleague: randomUUID() };
    const colleagueGrant = randomUUID();
    await transaction(ctx.pool, async client => {
      for (const key of Object.keys(synthetic) as Persona[]) await client.query('INSERT INTO identities(id,issuer,subject,phone,phone_verified,synthetic,last_seen_at) VALUES($1,$2,$3,$4,$5,true,$6)',
        [ids[key], issuer, `${world}:${key}`, synthetic[key], synthetic[key] !== null, ctx.clock()]);
      // No truck and no family grant: the guided journey creates both. The colleague keeps its fictional number and an
      // accepted grant, and never verifies by SMS code, so its alerts show as not allowed.
      await client.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES($1,$2,$3,$4,true,true,true,true,$5,'colleague')`, [colleagueGrant, ids.driver, ids.colleague, synthetic.colleague, ctx.clock()]);
    });
    // Verification checks exp against the real clock, so expiresAt does too.
    const exp = Math.floor(Date.now() / 1000) + LIFETIME_SECONDS;
    const token = (key: Persona) => demo.sign(`${world}:${key}`, exp);
    return { synthetic: true, expiresInSeconds: LIFETIME_SECONDS, expiresAt: new Date(exp * 1000).toISOString(), tripCountries: demo.tripCountries,
      driver: { id: ids.driver, token: await token('driver') },
      family: { id: ids.family, token: await token('family') },
      colleague: { id: ids.colleague, token: await token('colleague'), grantId: colleagueGrant } };
  });
}
```

`src/server.ts` keeps calling `demoIssuer(process.env)`, so it needs no change.

- [ ] **Step 4: Run the backend tests and watch them pass.** Run `npm run build && node --test tests/demo.test.mjs tests/client-read.test.mjs tests/insights.test.mjs`. Expected: all pass.

- [ ] **Step 5: Write the failing web test.** In `web/tests/api/runtime.test.mjs`, bottom up:
- Replace lines 161-162 (the `for (const raw of [...]) {` array) with:
```js
  for (const raw of [{ ...world(), synthetic: false }, { ...world(), expiresInSeconds: 999999 }, { ...world(), expiresAt: 'in two hours' },
    { ...world(), tripCountries: ['peru'] }, { ...world(), tripCountries: 'PE' },
    { ...world(), family: { ...world().family, id: trip } }, { ...world(), driver: { ...world().driver, token: 'not-a-jwt' } }]) {
```
- Replace line 143 with:
```js
  assert.equal(calls, 1); assert.equal(result.synthetic, true); assert.equal('secret' in result, false);
  assert.deepEqual(result.tripCountries, ['PE']); assert.equal(result.expiresAt, stamp);
  assert.equal('truckId' in result.driver, false); assert.equal('grantId' in result.family, false);
```
- Replace lines 16-20 (`function world() {…}`) with:
```js
function world() {
  return { synthetic: true, expiresInSeconds: 7200, expiresAt: stamp, tripCountries: ['PE'], driver: { id: trip, token: jwt('driver') },
    family: { id: family, token: jwt('family') },
    colleague: { id: colleague, token: jwt('colleague'), grantId: trip } };
}
```

- [ ] **Step 6: Run it and watch it fail.** Run `cd web && npm ci && npm test`. Expected FAIL in `tests/api/runtime.test.mjs`: `demo session is explicit…` rejects with an `invalid_response` ApiError, because the old decoder still requires `driver.truckId`.

- [ ] **Step 7: Implement the web decoder.** In `web/src/lib/api/types.ts`, replace lines 70-75 (`export interface DemoWorld {…}`) with:

```ts
export interface DemoWorld {
  synthetic: true; expiresInSeconds: 7200; expiresAt: string;
  /** Countries the trip form may offer: those with qualified alert channels. */
  tripCountries: string[];
  driver: { id: UUID; token: string };
  family: { id: UUID; token: string };
  colleague: { id: UUID; token: string; grantId: UUID };
}
```

In `web/src/lib/api/responses.ts`, replace lines 104-106 (`const demoWorldWire = …;`) with:

```ts
const countryCode: Decoder<string> = value => typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : invalid();
const demoWorldWire = object({ synthetic: literal(true), expiresInSeconds: literal(7200), expiresAt: date,
  tripCountries: array(countryCode), driver: object({ id: uuid, token }), family: object({ id: uuid, token }),
  colleague: object({ id: uuid, token, grantId: uuid }) });
```

In the opt-in `web/tests/api/runtime.integration.mjs` (it compiles the current backend source), replace line 127's `world.family.grantId` with `familyGrant`. Then replace lines 93-98 (from `const fields={truckId:world.driver.truckId,` through `{idempotencyKey:'real-confirm'});`) with:

```js
      // Sessions no longer seed a truck or a family grant (the guided journey creates both); this test seeds them directly.
      const truck=await api.createTruck({label:'Synthetic truck'},{idempotencyKey:'real-truck'});
      const familyGrant=(await ctx.pool.query(`INSERT INTO contact_grants(id,driver_id,contact_id,phone,map_requested,incident_requested,map_accepted,incident_accepted,accepted_at,role)
        VALUES(gen_random_uuid(),$1,$2,'+15555550102',true,true,true,true,$3,'family') RETURNING id`,[world.driver.id,world.family.id,serverReadStart])).rows[0].id;
      const fields={truckId:truck.id,origin:'Synthetic origin',destination:'Synthetic destination',
        country:'BR',locale:'pt-BR',timeZone:'America/Sao_Paulo',expectedArrivalAt:arrival};
      const draft=await api.createDraft({text:'Synthetic persisted draft',fields},{idempotencyKey:'real-draft'});
      assert.equal(draft.fields.expectedArrivalAt,arrival);
      await api.confirmTrip(draft.id,{confirmed:true,contactGrantIds:[familyGrant,world.colleague.grantId]},
        {idempotencyKey:'real-confirm'});
```

- [ ] **Step 8: Run the web tests and watch them pass.** Run `cd web && npm test && node node_modules/typescript/bin/tsc -p tests/api/tsconfig.json`. Expected: all pass and typecheck clean. The integration file is opt-in. Run it only if `ANDES_BACKEND_NODE_MODULES` and `ANDES_TYPESCRIPT_TSC` are available: `node --test tests/api/runtime.integration.mjs`. Back at the root, run `npm test`. Expected: all pass.

- [ ] **Step 9: Commit.**
```bash
git add src/demo.ts tests/demo.test.mjs tests/client-read.test.mjs web/src/lib/api/types.ts web/src/lib/api/responses.ts web/tests/api/runtime.test.mjs web/tests/api/runtime.integration.mjs
git commit -m "feat(demo): Start demo worlds without a truck or family grant"
```

---

### Task 7: Read demo phone settings from the environment

**Files:**
- Create: `src/demo-phone.ts`, `tests/demo-phone.test.mjs`

- [ ] **Step 1: Write the failing test.** Create `tests/demo-phone.test.mjs`. The imports cover the later tasks too:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/runtime.mjs';
import {runtime, provider, qualification} from './helpers/dispatch.mjs';

const pepper = 'syntheticfixture-pepper-not-a-secret-000';

test('demo phone settings: defaults, live-send requirements, countries, and no code from the environment', async () => {
  const {demoLimits} = await import('../dist/demo-phone.js');
  const live = {ZAVU_LIVE_SEND: 'true', DEMO_SMS_DAILY_CAP: '40', DEMO_ALERTS_PER_NUMBER_DAILY: '6', DEMO_PHONE_PEPPER: pepper};
  assert.deepEqual(demoLimits(live), {pepper, allowedCountries: ['PE'], perNumberHourly: 3, perIpHourly: 5, smsDailyCap: 40, alertsPerNumberDaily: 6});
  assert.deepEqual(demoLimits({...live, DEMO_ALLOWED_COUNTRIES: 'PE,BR,CL,CO,MX,AR', DEMO_OTP_PER_NUMBER_HOURLY: '1', DEMO_OTP_PER_IP_HOURLY: '2'}),
    {pepper, allowedCountries: ['PE', 'BR', 'CL', 'CO', 'MX', 'AR'], perNumberHourly: 1, perIpHourly: 2, smsDailyCap: 40, alertsPerNumberDaily: 6});
  for (const name of ['DEMO_SMS_DAILY_CAP', 'DEMO_ALERTS_PER_NUMBER_DAILY', 'DEMO_PHONE_PEPPER']) {
    assert.throws(() => demoLimits({...live, [name]: undefined}), new RegExp(name), `${name} missing`);
  }
  for (const [name, value] of [['DEMO_SMS_DAILY_CAP', '0'], ['DEMO_ALERTS_PER_NUMBER_DAILY', '1.5'], ['DEMO_OTP_PER_IP_HOURLY', 'five'], ['DEMO_OTP_PER_NUMBER_HOURLY', ''],
    ['DEMO_PHONE_PEPPER', 'too-short'], ['DEMO_ALLOWED_COUNTRIES', 'PE,XX'], ['DEMO_ALLOWED_COUNTRIES', 'pe']]) {
    assert.throws(() => demoLimits({...live, [name]: value}), new RegExp(name), `${name}=${value}`);
  }
  const off = demoLimits({}); // sends off: nothing can go out, so the caps and the pepper may be absent
  assert.deepEqual([off.smsDailyCap, off.alertsPerNumberDaily, off.allowedCountries], [0, 0, ['PE']]);
  assert.match(off.pepper, /^[0-9a-f]{64}$/); assert.notEqual(demoLimits({}).pepper, off.pepper);
  assert.equal('code' in demoLimits({...live, DEMO_OTP_CODE: '123456'}), false, 'a fixed code is never read from the environment');
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected FAIL: `ERR_MODULE_NOT_FOUND` for `dist/demo-phone.js`.

- [ ] **Step 3: Implement.** Create `src/demo-phone.ts`:

```ts
import { randomBytes } from 'node:crypto';
// ponytail: calling-code prefixes, not numbering plans; +1 is all of NANP (US, Canada, Caribbean). Add a country by adding its code.
export const CALLING_CODES: Record<string, string> = { AR: '54', BR: '55', CL: '56', CO: '57', MX: '52', PE: '51', US: '1' };
export interface DemoLimits { pepper: string; allowedCountries: string[]; perNumberHourly: number; perIpHourly: number; smsDailyCap: number; alertsPerNumberDaily: number }
/** Demo-mode settings. With ZAVU_LIVE_SEND=true the two caps and the pepper are required; with sends off nothing can go out. */
export function demoLimits(env: NodeJS.ProcessEnv): DemoLimits {
  const live = env.ZAVU_LIVE_SEND === 'true';
  const count = (name: string, fallback?: number): number => {
    const raw = env[name];
    if (raw === undefined) {
      if (fallback === undefined) throw new Error(`DEMO_MODE live sends require ${name}`);
      return fallback;
    }
    if (!/^[1-9]\d{0,8}$/.test(raw)) throw new Error(`${name} must be a positive integer`);
    return Number(raw);
  };
  const allowedCountries = (env.DEMO_ALLOWED_COUNTRIES ?? 'PE').split(',').map(code => code.trim());
  if (allowedCountries.some(code => !Object.hasOwn(CALLING_CODES, code))) throw new Error(`DEMO_ALLOWED_COUNTRIES may list only ${Object.keys(CALLING_CODES).join(',')}`);
  // Without live sends no code is ever stored, so a throwaway pepper is enough.
  const pepper = env.DEMO_PHONE_PEPPER ?? (live ? '' : randomBytes(32).toString('hex'));
  if (pepper.length < 32) throw new Error('DEMO_PHONE_PEPPER must be a random secret of at least 32 characters');
  return { pepper, allowedCountries, perNumberHourly: count('DEMO_OTP_PER_NUMBER_HOURLY', 3), perIpHourly: count('DEMO_OTP_PER_IP_HOURLY', 5),
    smsDailyCap: count('DEMO_SMS_DAILY_CAP', live ? undefined : 0), alertsPerNumberDaily: count('DEMO_ALERTS_PER_NUMBER_DAILY', live ? undefined : 0) };
}
```

- [ ] **Step 4: Run it and watch it pass.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected: 1 passing.

- [ ] **Step 5: Commit.**
```bash
git add src/demo-phone.ts tests/demo-phone.test.mjs
git commit -m "feat(demo): Read demo phone settings from the environment"
```

---

### Task 8: OTP tables and `POST /v1/demo/phone/start`

**Files:**
- Create: `db/migrations/010-demo-phone-otp.sql`
- Modify: `src/demo-phone.ts` (line 1 import; append), `src/api/app.ts` (import, options, `:42`), `src/server.ts` (imports; after the `provider` line; `createApp` call), `tests/demo-phone.test.mjs` (append)

- [ ] **Step 1: Write the failing tests.** Append to `tests/demo-phone.test.mjs`:

```js
// Fictional numbers only: +1 555 555 01xx is NANP ('US' below); +51 0… is not an assigned Peruvian mobile range.
const phone = '+15555550142', other = '+15555550143', code = '123456';
function phoneConfig(overrides = {}) {
  const sent = [];
  const config = {pepper, allowedCountries: ['US'], perNumberHourly: 3, perIpHourly: 5, smsDailyCap: 20, alertsPerNumberDaily: 6, code: () => code,
    send: async (to, text) => { sent.push({to, text}); return {state: 'accepted', messageId: `msg_${sent.length}`, status: 'queued'}; }, ...overrides};
  return {sent, config};
}
// The fake sender and the fixed code reach the app only as this in-process createApp option.
async function demoWorld(t, overrides) {
  const {demoIssuer} = await import('../dist/demo.js');
  const demo = await demoIssuer({});
  const {sent, config} = phoneConfig(overrides);
  const f = await fixture(t, {auth: demo.auth, demo, demoPhone: config, trustProxyHops: 1});
  async function session() { return (await f.app.inject({method: 'POST', url: '/v1/demo/session', payload: {}})).json(); }
  async function call(path, body, token, ip = '198.51.100.7') {
    const response = await f.app.inject({method: 'POST', url: `/v1/demo/phone/${path}`, payload: body, headers: {authorization: `Bearer ${token}`, 'x-forwarded-for': ip}});
    return {status: response.statusCode, body: response.json()};
  }
  return {f, sent, session, call};
}
async function challenges(f) { return (await f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_challenges')).rows[0].n; }

test('a code request sends one demo-prefixed SMS without URLs and stores only HMACs of the number and the IP', async t => {
  const w = await demoWorld(t); const world = await w.session();
  assert.deepEqual(await w.call('start', {phone}, world.family.token), {status: 202, body: {expiresAt: '2026-10-17T12:10:00.000Z'}});
  assert.deepEqual(w.sent, [{to: phone, text: 'Demo de Tándem: tu código es 123456'}]);
  assert.doesNotMatch(w.sent[0].text, /http/, 'Zavu holds SMS with unverified URLs');
  const rows = (await w.f.ctx.pool.query('SELECT identity_id,phone_hmac,ip_hmac,code_hash,attempts FROM demo_phone_challenges')).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].identity_id, world.family.id); assert.equal(rows[0].attempts, 0);
  for (const key of ['phone_hmac', 'ip_hmac', 'code_hash']) assert.match(rows[0][key], /^[0-9a-f]{64}$/, key);
  const stored = JSON.stringify(rows);
  for (const secret of [phone.slice(1), '198.51.100.7']) assert.ok(!stored.includes(secret), secret);
  assert.equal((await w.f.app.inject({method: 'POST', url: '/v1/demo/phone/start', payload: {phone}})).statusCode, 401, 'the actor is the token persona');
});

test('malformed numbers and countries outside DEMO_ALLOWED_COUNTRIES are refused before any SMS', async t => {
  const w = await demoWorld(t); const world = await w.session();
  for (const bad of ['15555550142', '+0155555501', '+1555', 'tel:+15555550142', '+15555550142 ', '+1 555 555 0142']) {
    assert.deepEqual(await w.call('start', {phone: bad}, world.family.token), {status: 400, body: {code: 'invalid_phone'}}, bad);
  }
  assert.deepEqual(await w.call('start', {phone: '+51000000001'}, world.family.token), {status: 403, body: {code: 'country_not_allowed'}});
  assert.equal((await w.call('start', {}, world.family.token)).status, 400);
  assert.deepEqual([w.sent.length, await challenges(w.f)], [0, 0]);
});

test('with live sends off the code request answers 503 demo_sms_disabled and is never counted', async t => {
  const w = await demoWorld(t, {send: null}); const world = await w.session();
  for (let i = 0; i < 8; i++) assert.deepEqual(await w.call('start', {phone}, world.family.token), {status: 503, body: {code: 'demo_sms_disabled'}});
  assert.equal(await challenges(w.f), 0);
});

test('a number gets at most DEMO_OTP_PER_NUMBER_HOURLY codes per hour, across worlds and IPs', async t => {
  const w = await demoWorld(t);
  for (let i = 0; i < 3; i++) assert.equal((await w.call('start', {phone}, (await w.session()).family.token, `198.51.100.${10 + i}`)).status, 202);
  assert.deepEqual(await w.call('start', {phone}, (await w.session()).family.token, '198.51.100.20'), {status: 429, body: {code: 'rate_limited'}});
  w.f.advance(3600001);
  assert.equal((await w.call('start', {phone}, (await w.session()).family.token, '198.51.100.21')).status, 202);
  assert.equal(w.sent.length, 4);
});

test('an IP gets at most DEMO_OTP_PER_IP_HOURLY codes per hour, and a forged X-Forwarded-For entry does not reset it', async t => {
  const w = await demoWorld(t); const token = (await w.session()).family.token;
  for (let i = 0; i < 5; i++) assert.equal((await w.call('start', {phone: `+1555555016${i}`}, token, '203.0.113.9')).status, 202);
  assert.deepEqual(await w.call('start', {phone: '+15555550165'}, token, '203.0.113.9'), {status: 429, body: {code: 'rate_limited'}});
  assert.deepEqual(await w.call('start', {phone: '+15555550166'}, token, '192.0.2.1, 203.0.113.9'), {status: 429, body: {code: 'rate_limited'}}, 'the client-written entry is ignored');
  assert.equal((await w.call('start', {phone: '+15555550167'}, token, '203.0.113.10')).status, 202);
  assert.equal(w.sent.length, 6);
});

test('DEMO_SMS_DAILY_CAP stops every code request for 24 hours with demo_budget_exhausted', async t => {
  const w = await demoWorld(t, {smsDailyCap: 2}); const token = (await w.session()).family.token;
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.equal((await w.call('start', {phone: other}, token)).status, 202);
  const exhausted = {status: 429, body: {code: 'demo_budget_exhausted'}};
  assert.deepEqual(await w.call('start', {phone: '+15555550144'}, token), exhausted);
  w.f.advance(3600001); assert.deepEqual(await w.call('start', {phone: '+15555550144'}, token), exhausted, 'not an hourly window');
  w.f.advance(23 * 3600000); assert.equal((await w.call('start', {phone: '+15555550144'}, token)).status, 202);
  assert.equal(w.sent.length, 3);
});

test('a provider refusal answers 503 and still counts; an ambiguous provider result answers 202', async t => {
  let result = {state: 'rejected', code: 'invalid_destination'};
  const w = await demoWorld(t, {send: async () => result}); const token = (await w.session()).family.token;
  assert.deepEqual(await w.call('start', {phone}, token), {status: 503, body: {code: 'demo_sms_disabled'}});
  result = {state: 'unknown'};
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.equal(await challenges(w.f), 2);
});

test('without demo mode the phone routes do not exist', async t => {
  const f = await fixture(t, {demoPhone: phoneConfig().config});
  assert.equal((await f.req('POST', '/v1/demo/phone/start', {phone})).status, 404);
  assert.equal((await f.req('POST', '/v1/demo/phone/verify', {phone, code})).status, 404);
});

test('codes go out through the Zavu adapter on the one-way SMS sender', async () => {
  const {zavuSender} = await import('../dist/demo-phone.js');
  const {createZavuProvider} = await import('../dist/notifications/zavu.js');
  const bodies = [];
  const p = createZavuProvider({...qualification, smsMode: 'oneway'}, 'syntheticfixture-key', async (_url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    return new Response(JSON.stringify({message: {id: 'msg_code', channel: body.channel, to: body.to, status: 'queued', direction: 'outbound'}}), {status: 202});
  });
  assert.equal((await zavuSender(p)(phone, 'Demo de Tándem: tu código es 123456')).state, 'accepted');
  assert.equal(bodies.length, 1);
  const {channel, messageType, text, to, fallbackEnabled} = bodies[0];
  assert.deepEqual({channel, messageType, text, to, fallbackEnabled}, {channel: 'sms_oneway', messageType: 'text', text: 'Demo de Tándem: tu código es 123456', to: phone, fallbackEnabled: false});
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected FAIL: `{status: 404, …}` instead of 202 (the route does not exist), and `zavuSender is not a function`.

- [ ] **Step 3: Write the migration.** Create `db/migrations/010-demo-phone-otp.sql`:

```sql
-- Demo mode only: SMS codes that bind a contact's own number to a demo persona. The number, the IP and the code are
-- stored only as HMACs keyed with DEMO_PHONE_PEPPER; created_at feeds the per-number, per-IP and daily caps.
CREATE TABLE demo_phone_challenges (
  id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES identities,
  phone_hmac text NOT NULL, ip_hmac text NOT NULL, code_hash text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX demo_phone_challenges_window ON demo_phone_challenges(created_at);
CREATE INDEX demo_phone_challenges_lookup ON demo_phone_challenges(identity_id, phone_hmac, created_at);
-- The OTP mark dispatch requires in demo mode. Only POST /v1/demo/phone/verify writes it; seeded personas never get one.
CREATE TABLE demo_phone_verifications (
  identity_id uuid PRIMARY KEY REFERENCES identities, phone text NOT NULL, verified_at timestamptz NOT NULL
);
```

- [ ] **Step 4: Implement the route.** In `src/demo-phone.ts`, replace line 1 (`import { randomBytes } from 'node:crypto';`) with:

```ts
import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { problem } from './contracts.js';
import { transaction, type Context } from './db.js';
import { object } from './api/schemas.js';
import { textPayload, type Outcome, type Provider } from './notifications/zavu.js';
```

Append to the end of `src/demo-phone.ts`:

```ts
/** Every demo text starts with this: the code SMS below, and alert texts are checked at worker startup (src/worker.ts). */
export const DEMO_PREFIX = 'Demo de Tándem';
export type CodeSender = (to: string, text: string) => Promise<Outcome>;
/** Settings plus the code sender. `send: null` (ZAVU_LIVE_SEND=false) answers 503 before anything is counted. `code` is an
 * in-process test seam for createApp only; nothing reads a fixed code from the environment. */
export type DemoPhoneConfig = DemoLimits & { send: CodeSender | null; code?: () => string };
/** Codes go out on the qualified sender's SMS channel (sms_oneway when configured), outside alert qualification. */
export const zavuSender = (provider: Provider): CodeSender => (to, text) => provider.send(textPayload(provider.qualification, to, text, randomUUID()));
const E164 = /^\+[1-9]\d{6,14}$/, HOUR = 3600000, DAY = 86400000, CODE_MS = 600000;
export function demoPhoneRoutes(app: FastifyInstance, ctx: Context, config: DemoPhoneConfig) {
  const mac = (kind: string, value: string) => createHmac('sha256', config.pepper).update(`${kind}:${value}`).digest('hex');
  app.post('/v1/demo/phone/start', { schema: { body: object({ phone: { type: 'string' } }) } }, async (request, reply) => {
    const { phone } = request.body as { phone: string };
    if (!E164.test(phone)) problem(400, 'invalid_phone');
    if (!config.allowedCountries.some(country => phone.startsWith(`+${CALLING_CODES[country]}`))) problem(403, 'country_not_allowed');
    if (!config.send) return reply.code(503).send({ code: 'demo_sms_disabled' }); // counted against nothing
    const now = ctx.clock(), id = randomUUID(), expiresAt = new Date(now.getTime() + CODE_MS);
    const code = config.code?.() ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const phoneHmac = mac('phone', phone), ipHmac = mac('ip', request.ip);
    const refused = await transaction(ctx.pool, async client => {
      // ponytail: one global lock serializes code requests so no cap can be overshot; fine for one demo instance.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('demo_phone_start',0))");
      const used = (await client.query(`SELECT count(*)::int AS day, count(*) FILTER (WHERE created_at>$2 AND phone_hmac=$3)::int AS phone,
          count(*) FILTER (WHERE created_at>$2 AND ip_hmac=$4)::int AS ip FROM demo_phone_challenges WHERE created_at>$1`,
        [new Date(now.getTime() - DAY), new Date(now.getTime() - HOUR), phoneHmac, ipHmac])).rows[0];
      if (used.day >= config.smsDailyCap) return 'demo_budget_exhausted';
      if (used.phone >= config.perNumberHourly || used.ip >= config.perIpHourly) return 'rate_limited';
      await client.query('INSERT INTO demo_phone_challenges(id,identity_id,phone_hmac,ip_hmac,code_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, request.actor.id, phoneHmac, ipHmac, mac('code', `${id}:${code}`), now, expiresAt]);
      return null;
    });
    if (refused) problem(429, refused);
    // Sent after commit, never inside a transaction. A request counts even if the provider refuses it, so failures cannot be retried past the caps.
    const sent = await config.send(phone, `${DEMO_PREFIX}: tu código es ${code}`);
    if (sent.state === 'rejected') return reply.code(503).send({ code: 'demo_sms_disabled' });
    return reply.code(202).send({ expiresAt: expiresAt.toISOString() });
  });
}
```

In `src/api/app.ts`:
- After the `import { isWebRoute, webRoutes } from './web.js';` line, add:
```ts
import { demoPhoneRoutes, type DemoPhoneConfig } from '../demo-phone.js';
```
- In `AppOptions`, add `demoPhone?: DemoPhoneConfig;` after `demo?: DemoIssuer;`, and add `demoPhone` to the destructuring after `demo`.
- Replace line 42 (`  if (demo) demoRoutes(app, ctx, demo);`) with:
```ts
  if (demo) { demoRoutes(app, ctx, demo); if (demoPhone) demoPhoneRoutes(app, ctx, demoPhone); } // DEMO_MODE only
```

In `src/server.ts`:
- After `import { demoIssuer } from './demo.js';` add:
```ts
import { demoLimits, zavuSender } from './demo-phone.js';
```
- After `const provider = configuredProvider(process.env);` add:
```ts
// Demo codes go out only with live sends; with ZAVU_LIVE_SEND=false the start route answers 503 demo_sms_disabled.
const demoPhone = demo ? { ...demoLimits(process.env), send: provider?.qualification.live ? zavuSender(provider) : null } : undefined;
```
- In the `createApp({...})` call, change `demo,` to `demo, demoPhone,`.

- [ ] **Step 5: Run them and watch them pass.** Run `npm run build && node --test tests/demo-phone.test.mjs tests/demo.test.mjs`. Expected: all pass, including `the real server entry stays off demo mode…`: with only `DEMO_MODE=true`, `demoLimits` falls back to sends-off defaults and the server still stops at the database configuration. Then run `npm run typecheck`. Expected: clean.

- [ ] **Step 6: Commit.**
```bash
git add db/migrations/010-demo-phone-otp.sql src/demo-phone.ts src/api/app.ts src/server.ts tests/demo-phone.test.mjs
git commit -m "feat(demo): Send SMS codes with per-number, per-IP and daily caps"
```

---

### Task 9: `POST /v1/demo/phone/verify`

**Files:**
- Modify: `src/demo-phone.ts` (crypto import; the constants line; the end of `demoPhoneRoutes`), `tests/demo-phone.test.mjs` (append)

- [ ] **Step 1: Write the failing tests.** Append to `tests/demo-phone.test.mjs`:

```js
test('the right code binds the number to that persona only, once', async t => {
  const w = await demoWorld(t); const world = await w.session();
  assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
  assert.deepEqual(await w.call('verify', {phone, code}, world.family.token), {status: 200, body: {verified: true}});
  assert.deepEqual((await w.f.ctx.pool.query('SELECT identity_id,phone FROM demo_phone_verifications')).rows, [{identity_id: world.family.id, phone}]);
  assert.deepEqual((await w.f.ctx.pool.query('SELECT id,phone,phone_verified FROM identities WHERE id=ANY($1) ORDER BY phone', [[world.driver.id, world.family.id, world.colleague.id]])).rows,
    [{id: world.driver.id, phone: '+15555550101', phone_verified: true}, {id: world.colleague.id, phone: '+15555550103', phone_verified: true}, {id: world.family.id, phone, phone_verified: true}]);
  assert.deepEqual(await w.call('verify', {phone, code}, world.family.token), {status: 410, body: {code: 'code_expired'}}, 'a used code is spent');
});

test('wrong, malformed, expired and exhausted codes never verify', async t => {
  const w = await demoWorld(t); const world = await w.session(); const token = world.family.token;
  const invalid = {status: 400, body: {code: 'invalid_code'}};
  assert.deepEqual(await w.call('verify', {phone, code}, token), invalid, 'no code was requested');
  assert.equal((await w.call('start', {phone}, token)).status, 202);
  assert.deepEqual(await w.call('verify', {phone: other, code}, token), invalid, 'another number');
  for (const wrong of ['000000', 'abc', '1234567', '12345']) assert.deepEqual(await w.call('verify', {phone, code: wrong}, token), invalid, wrong);
  assert.deepEqual(await w.call('verify', {phone, code: '000001'}, token), invalid, 'fifth try');
  assert.deepEqual(await w.call('verify', {phone, code}, token), {status: 429, body: {code: 'too_many_attempts'}}, 'the right code after five tries');
  assert.equal((await w.call('start', {phone: other}, token)).status, 202);
  w.f.advance(600000);
  assert.deepEqual(await w.call('verify', {phone: other, code}, token), {status: 410, body: {code: 'code_expired'}}, '10 minutes');
  assert.deepEqual((await w.f.ctx.pool.query('SELECT phone,phone_verified FROM identities WHERE id=$1', [world.family.id])).rows, [{phone: null, phone_verified: false}]);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_verifications')).rows[0].n, 0);
});

test('a code is bound to the persona and world that asked for it', async t => {
  const w = await demoWorld(t); const a = await w.session(); const b = await w.session();
  assert.equal((await w.call('start', {phone}, a.family.token)).status, 202);
  const invalid = {status: 400, body: {code: 'invalid_code'}};
  assert.deepEqual(await w.call('verify', {phone, code}, b.family.token), invalid, 'another world');
  assert.deepEqual(await w.call('verify', {phone, code}, a.driver.token), invalid, 'another persona');
  assert.deepEqual(await w.call('verify', {phone, code}, a.family.token), {status: 200, body: {verified: true}});
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: b.family.id, phone, map: true, incident: true}, b.driver.token);
  assert.deepEqual(await w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, b.family.token),
    {status: 409, body: {code: 'verified_phone_mismatch'}}, 'world B never verified it');
});

test('the contact can accept the invitation only after verifying the invited number', async t => {
  const w = await demoWorld(t); const world = await w.session();
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: world.family.id, phone, map: true, incident: true}, world.driver.token);
  const accept = () => w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, world.family.token);
  assert.deepEqual(await accept(), {status: 409, body: {code: 'verified_phone_mismatch'}});
  assert.equal((await w.call('start', {phone}, world.family.token)).status, 202);
  assert.equal((await w.call('verify', {phone, code}, world.family.token)).status, 200);
  assert.deepEqual(await accept(), {status: 200, body: {id: invite.body.id, map: true, incident: true, status: 'accepted'}});
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected FAIL: verify returns `{status: 404, …}`.

- [ ] **Step 3: Implement.** In `src/demo-phone.ts`:
- Change `import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';` to `import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';`.
- Change `const E164 = /^\+[1-9]\d{6,14}$/, HOUR = 3600000, DAY = 86400000, CODE_MS = 600000;` to `const E164 = /^\+[1-9]\d{6,14}$/, HOUR = 3600000, DAY = 86400000, CODE_MS = 600000, MAX_ATTEMPTS = 5;`.
- Replace the end of `demoPhoneRoutes`:
```ts
    if (sent.state === 'rejected') return reply.code(503).send({ code: 'demo_sms_disabled' });
    return reply.code(202).send({ expiresAt: expiresAt.toISOString() });
  });
}
```
with:
```ts
    if (sent.state === 'rejected') return reply.code(503).send({ code: 'demo_sms_disabled' });
    return reply.code(202).send({ expiresAt: expiresAt.toISOString() });
  });
  app.post('/v1/demo/phone/verify', { schema: { body: object({ phone: { type: 'string' }, code: { type: 'string' } }) } }, async request => {
    const { phone, code } = request.body as { phone: string; code: string };
    // Decided inside the transaction, thrown after commit, so a failed try still counts.
    const failed = await transaction(ctx.pool, async client => {
      const now = ctx.clock();
      // Only this persona's latest code for this number: a code another persona or world asked for is never found.
      const challenge = (await client.query('SELECT id,code_hash,expires_at,attempts FROM demo_phone_challenges WHERE identity_id=$1 AND phone_hmac=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
        [request.actor.id, mac('phone', phone)])).rows[0];
      if (!challenge) return 'invalid_code';
      if (challenge.attempts >= MAX_ATTEMPTS) return 'too_many_attempts';
      if (challenge.expires_at <= now) return 'code_expired';
      const match = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(mac('code', `${challenge.id}:${code}`), 'hex'), Buffer.from(challenge.code_hash, 'hex'));
      // Every try counts, and a matching code is spent at once (it expires now).
      await client.query('UPDATE demo_phone_challenges SET attempts=attempts+1,expires_at=CASE WHEN $2 THEN $3 ELSE expires_at END WHERE id=$1', [challenge.id, match, now]);
      if (!match) return 'invalid_code';
      // The OTP mark dispatch requires, plus the identity binding contact acceptance reads. This persona only.
      await client.query(`INSERT INTO demo_phone_verifications(identity_id,phone,verified_at) VALUES($1,$2,$3)
        ON CONFLICT(identity_id) DO UPDATE SET phone=excluded.phone,verified_at=excluded.verified_at`, [request.actor.id, phone, now]);
      await client.query('UPDATE identities SET phone=$2,phone_verified=true WHERE id=$1', [request.actor.id, phone]);
      return null;
    });
    if (failed) problem({ invalid_code: 400, code_expired: 410, too_many_attempts: 429 }[failed], failed);
    return { verified: true };
  });
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected: all pass. Then run `npm run typecheck`. Expected: clean.

- [ ] **Step 5: Commit.**
```bash
git add src/demo-phone.ts tests/demo-phone.test.mjs
git commit -m "feat(demo): Verify SMS codes and bind the number to that persona"
```

---

### Task 10: Fail-closed OTP allowlist, per-number cap and live demo startup rules

**Files:**
- Modify: `src/notifications/dispatch.ts:8` (type), `:65`, `:78`, `:90-92`, `:103-110`, `:189`, `:194`, `:263`, `:276`; `src/notifications/zavu.ts:9-12` (comments); `src/worker.ts:1-20,40,49`; `tests/demo.test.mjs` (the test `live demo provider startup requires the consented allowlist and a budget`); `tests/demo-phone.test.mjs` (append)

- [ ] **Step 1: Write the failing dispatch tests.** Append to `tests/demo-phone.test.mjs`:

```js
const demoPolicy = {enabled: true, alertsPerNumberDaily: 6};
const demoBudget = {perIncident: 6, perSession: 6};
// The whole guided journey: the family verifies its number, is invited and accepts; the trip adds the seeded colleague; SOS.
async function verifiedWorld(w, number) {
  const world = await w.session();
  assert.equal((await w.call('start', {phone: number}, world.family.token)).status, 202);
  assert.equal((await w.call('verify', {phone: number, code}, world.family.token)).status, 200);
  const truck = (await w.f.req('POST', '/v1/trucks', {label: 'SYNTHETIC demo truck'}, world.driver.token)).body.id;
  const invite = await w.f.req('POST', '/v1/contacts', {contactId: world.family.id, phone: number, map: true, incident: true, role: 'family'}, world.driver.token);
  assert.equal(invite.status, 200);
  assert.equal((await w.f.req('POST', `/v1/contacts/${invite.body.id}/accept`, {map: true, incident: true}, world.family.token)).status, 200);
  const draft = await w.f.req('POST', '/v1/trip-drafts', {text: 'SYNTHETIC demo trip', fields: {truckId: truck, origin: 'A', destination: 'B', country: 'BR', locale: 'pt-BR', timeZone: 'America/Sao_Paulo'}}, world.driver.token);
  const trip = (await w.f.req('POST', `/v1/trip-drafts/${draft.body.id}/confirm`, {confirmed: true, contactGrantIds: [invite.body.id, world.colleague.grantId]}, world.driver.token)).body.id;
  const incident = (await w.f.req('POST', `/v1/trips/${trip}/sos`, {}, world.driver.token)).body.id;
  const jobs = (await w.f.ctx.pool.query('SELECT j.id,j.version,j.class,cg.role FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 ORDER BY cg.role,j.channel', [incident])).rows;
  return {world, trip, incident, jobs};
}
async function deliveries(f, incident) {
  return (await f.ctx.pool.query(`SELECT cg.role,j.status,j.unavailable_reason,a.payload->>'to' AS "to",count(*)::int n FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id
    LEFT JOIN dispatch_attempts a ON a.job_id=j.id WHERE j.incident_id=$1 GROUP BY 1,2,3,4 ORDER BY 1`, [incident])).rows;
}
async function authorizeAll(w, jobs, p, demo) {
  const d = await runtime();
  for (const job of jobs) await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, job, 'demo'), p, demo);
}
async function familyJobs(f, incident) {
  return (await f.ctx.pool.query("SELECT j.channel,j.status,j.unavailable_reason FROM jobs j JOIN contact_grants cg ON cg.id=j.grant_id WHERE j.incident_id=$1 AND cg.role='family' ORDER BY j.channel", [incident])).rows;
}

test('live demo alerts reach only a number the recipient verified by SMS code; the seeded colleague is not allowed', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone);
  // An empty static allowlist would refuse everyone: in demo mode it is replaced, not combined.
  await authorizeAll(w, jobs, provider({qualification: {...qualification, allowedDestinations: [], demoLimits: demoBudget}}), demoPolicy);
  assert.deepEqual(await deliveries(w.f, incident), [
    {role: 'colleague', status: 'unavailable', unavailable_reason: 'destination_not_allowed', to: null, n: 2},
    {role: 'family', status: 'authorized', unavailable_reason: null, to: phone, n: 3}]);
});

test('an OTP mark for another number does not authorize the grant number', async t => {
  const w = await demoWorld(t); const {incident, jobs, world} = await verifiedWorld(w, phone);
  await w.f.ctx.pool.query('UPDATE demo_phone_verifications SET phone=$2 WHERE identity_id=$1', [world.family.id, other]);
  await authorizeAll(w, jobs, provider({qualification: {...qualification, demoLimits: demoBudget}}), demoPolicy);
  assert.deepEqual((await deliveries(w.f, incident)).map(row => [row.role, row.unavailable_reason, row.n]),
    [['colleague', 'destination_not_allowed', 2], ['family', 'destination_not_allowed', 3]]);
});

test('a missing or incomplete demo policy fails closed', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone);
  const d = await runtime(); const p = provider({qualification: {...qualification, demoLimits: demoBudget}});
  const family = jobs.filter(job => job.role === 'family');
  // No policy: a demo persona is never contacted, even OTP-verified.
  assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, family[0], 'none'), p), null);
  // A policy without a per-number cap, or a qualification without demoLimits, exhausts the budget.
  assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, family[1], 'nocap'), p, {enabled: true}), null);
  assert.equal(await d.authorizeJob(w.f.ctx, await d.claimJob(w.f.ctx, family[2], 'nolimits'), provider(), demoPolicy), null);
  assert.deepEqual(await familyJobs(w.f, incident), [
    {channel: 'sms', status: 'unavailable', unavailable_reason: 'destination_not_allowed'},
    {channel: 'voice', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'},
    {channel: 'whatsapp', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'}]);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM dispatch_attempts')).rows[0].n, 0);
});

test('DEMO_ALERTS_PER_NUMBER_DAILY caps alerts to one verified number per day', async t => {
  const w = await demoWorld(t); const {incident, jobs} = await verifiedWorld(w, phone);
  await authorizeAll(w, jobs.filter(job => job.role === 'family'), provider({qualification: {...qualification, demoLimits: demoBudget}}), {enabled: true, alertsPerNumberDaily: 2});
  assert.deepEqual(await familyJobs(w.f, incident), [
    {channel: 'sms', status: 'authorized', unavailable_reason: null},
    {channel: 'voice', status: 'authorized', unavailable_reason: null},
    {channel: 'whatsapp', status: 'unavailable', unavailable_reason: 'demo_budget_exhausted'}]);
});

test('delivery workers pass the demo policy through to authorization', async t => {
  const w = await demoWorld(t); const {jobs} = await verifiedWorld(w, phone); const d = await runtime();
  const sent = [];
  const p = provider({qualification: {...qualification, demoLimits: demoBudget}, async send(payload) { sent.push(payload.to); return {state: 'accepted', messageId: `msg_${sent.length}`, status: 'queued'}; }});
  const batch = jobs.map((job, i) => ({body: {jobId: job.id, version: job.version, class: job.class}, receipt: `r${i}`}));
  const abort = new AbortController(); let acked = 0;
  const transport = {
    async receive(_kind, signal) { if (batch.length) return batch.splice(0); await new Promise(resolve => signal.addEventListener('abort', resolve, {once: true})); return []; },
    async ack() { if (++acked === jobs.length) abort.abort(); }, async defer() {}};
  await d.consume(w.f.ctx, transport, p, 'emergency', {sms: 2, whatsapp: 2, voice: 2}, abort.signal, demoPolicy);
  assert.deepEqual(sent, [phone, phone, phone]);
});
```

- [ ] **Step 2: Write the failing startup test.** In `tests/demo.test.mjs`, replace the whole test `live demo provider startup requires the consented allowlist and a budget`, from its `test(` line to its closing `});`, with:

```js
test('a live demo starts only with demo budgets, a pepper and demo-prefixed alert texts; no static allowlist is needed', async () => {
  const {configuredProvider, demoDispatch} = await import('../dist/worker.js');
  const demoText = {...qualification, evidence: 'test-only syntheticfixture: live',
    entries: qualification.entries.map(e => ({...e, evidence: 'test-only syntheticfixture: channel', text: 'Demo de Tándem: estado sin confirmar.'}))};
  const env = {ZAVU_LIVE_SEND: 'true', ZAVU_API_KEY: 'syntheticfixture-not-a-key', ZAVU_PROJECT_ID: 'prj_fixture', ZAVU_SENDER_ID: 'snd_fixture', ZAVU_CALLBACK_SECRET: 'syntheticfixture-secret',
    DEMO_MODE: 'true', DEMO_SMS_DAILY_CAP: '40', DEMO_ALERTS_PER_NUMBER_DAILY: '6', DEMO_PHONE_PEPPER: 'syntheticfixture-pepper-not-a-secret-000'};
  const limits = {perIncident: 6, perSession: 6};
  const start = (q, extra = {}) => configuredProvider({...env, ...extra, ZAVU_QUALIFICATION_JSON: JSON.stringify(q)});
  assert.deepEqual(start({...demoText, demoLimits: limits}).qualification.demoLimits, limits);
  assert.throws(() => start(demoText), /demoLimits/);
  for (const name of ['DEMO_SMS_DAILY_CAP', 'DEMO_ALERTS_PER_NUMBER_DAILY', 'DEMO_PHONE_PEPPER']) {
    assert.throws(() => start({...demoText, demoLimits: limits}, {[name]: undefined}), new RegExp(name), name);
  }
  const plain = {...demoText, demoLimits: limits, entries: demoText.entries.map((e, i) => i ? e : {...e, text: 'ANDES: estado sin confirmar.'})};
  assert.throws(() => start(plain), /Demo de Tándem/);
  assert.throws(() => start(plain, {ZAVU_LIVE_SEND: 'false'}), /Demo de Tándem/, 'even with sends off');
  assert.ok(start(plain, {DEMO_MODE: undefined}), 'production keeps its own texts');
  assert.ok(start({...demoText, demoLimits: limits, entries: demoText.entries.map(e => ({...e, text: e.text.normalize('NFD')}))}), 'decomposed accents');
  for (const demoLimits of [{perIncident: 0, perSession: 6}, {perIncident: 6}, 'six']) assert.throws(() => start({...demoText, demoLimits}), /qualification/);
  assert.deepEqual(demoDispatch(env), {enabled: true, alertsPerNumberDaily: 6});
  assert.equal(demoDispatch({}), undefined);
  assert.throws(() => demoDispatch({...env, DEMO_ALERTS_PER_NUMBER_DAILY: undefined}), /DEMO_ALERTS_PER_NUMBER_DAILY/);
});
```

- [ ] **Step 3: Run them and watch them fail.** Run `npm run build && node --test tests/demo-phone.test.mjs tests/demo.test.mjs`. Expected FAIL: the family ends `destination_not_allowed` under the empty static allowlist, because `authorizeJob` ignores the policy. The startup test throws `DEMO_MODE live sends require allowedDestinations exactly [DEMO_LIVE_PHONE] and demoLimits`, and `demoDispatch is not a function`.

- [ ] **Step 4: Implement dispatch.** In `src/notifications/dispatch.ts`:
- After line 8 (`export type WorkClass = 'emergency' | 'ordinary';`) add:
```ts
/** Demo-mode dispatch policy, built once at worker start (src/worker.ts demoDispatch). */
export interface DemoDispatch { enabled: boolean; alertsPerNumberDaily: number }
```
- Line 65 becomes:
```ts
export async function authorizeJob(ctx: Context, claim: Claim | null, provider: Provider, demo?: DemoDispatch): Promise<Attempt | null> {
```
- Line 78: change `SELECT cg.*,tg.revoked_at AS trip_revoked_at,i.phone AS verified_phone,i.phone_verified` to `SELECT cg.*,tg.revoked_at AS trip_revoked_at,i.phone AS verified_phone,i.phone_verified,i.synthetic AS recipient_synthetic`.
- Replace lines 90-92 (the `allowedDestinations` block) with:
```ts
    // Demo worlds (synthetic recipients) reach only a number the recipient itself verified by SMS code, and only under the
    // worker's explicit demo policy: that replaces the static allowlist. Without the policy a demo persona is never contacted.
    const allowed = demo?.enabled || grant.recipient_synthetic
      ? Boolean(demo?.enabled && (await client.query('SELECT 1 FROM demo_phone_verifications WHERE identity_id=$1 AND phone=$2', [grant.contact_id, grant.phone])).rowCount)
      : !q.allowedDestinations || q.allowedDestinations.includes(grant.phone);
    if (!allowed) {
      await client.query("UPDATE jobs SET status='unavailable',unavailable_reason='destination_not_allowed' WHERE id=$1", [job.id]); return null;
    }
```
- Replace lines 103-110 (the `if (q.demoLimits) {…}` block) with:
```ts
    if (q.demoLimits || demo?.enabled) {
      // Under the account lock, so concurrent workers cannot overshoot. Per session = per recipient identity; per number = the
      // destination across every world over the last 24 h. Demo mode without demoLimits or a numeric per-number cap fails closed.
      // ponytail: destination_hash has no index; add one if demo attempts reach the tens of thousands.
      const used = (await client.query(`SELECT count(*) FILTER (WHERE j.incident_id=$1)::int AS incident,count(*) FILTER (WHERE j.recipient_id=$2)::int AS session,
          count(*) FILTER (WHERE a.destination_hash=$3 AND a.authorized_at>$4)::int AS number
        FROM dispatch_attempts a JOIN jobs j ON j.id=a.job_id WHERE j.incident_id=$1 OR j.recipient_id=$2 OR a.destination_hash=$3`,
      [job.incident_id, job.recipient_id, hash(grant.phone), after(now, -86400000)])).rows[0];
      const limits = q.demoLimits;
      if (!limits || used.incident >= limits.perIncident || used.session >= limits.perSession || (demo?.enabled && !(used.number < demo.alertsPerNumberDaily))) {
        await client.query("UPDATE jobs SET status='unavailable',unavailable_reason='demo_budget_exhausted' WHERE id=$1", [job.id]); return null;
      }
    }
```
- Line 189 becomes `export async function runJob(ctx: Context, message: Envelope, provider: Provider, owner: string, signal?: AbortSignal, demo?: DemoDispatch): Promise<void> {`, and line 194 becomes `  const attempt = await authorizeJob(ctx, claim, provider, demo);`.
- Line 263 becomes `export async function consume(ctx: Context, transport: Transport, provider: Provider, kind: WorkClass, limits: Record<Channel, number>, signal: AbortSignal, demo?: DemoDispatch): Promise<void> {`, and in line 276 change `runJob(ctx, message.body, provider, randomUUID(), signal)` to `runJob(ctx, message.body, provider, randomUUID(), signal, demo)`.

In `src/notifications/zavu.ts`, update the two comments in `Qualification`. Line 9 becomes `  /** Optional: only these E.164 destinations may be sent to (replaced by OTP verification in demo mode). */`. Line 11 becomes `  /** Live-send budget, checked at authorization: attempts per incident and per recipient identity. Required in live demo mode. */`.

- [ ] **Step 5: Implement the worker.** In `src/worker.ts`:
- Line 5 becomes:
```ts
import { consume, recoverWork, reconcileOnce, relayOnce, type DemoDispatch, type Transport, type WorkClass } from './notifications/dispatch.js';
```
- After line 9 (the `checks/sweep.js` import) add:
```ts
import { DEMO_PREFIX, demoLimits } from './demo-phone.js';
```
- Replace lines 15-18 (the `DEMO_LIVE_PHONE` guard) with:
```ts
  if (env.DEMO_MODE === 'true') {
    // Alert texts come from configuration: in demo mode each must say it is a demo (the WhatsApp template is checked by hand).
    if (qualification.entries.some(entry => !entry.text.normalize('NFC').startsWith(DEMO_PREFIX))) throw new Error(`DEMO_MODE alert texts must start with «${DEMO_PREFIX}»`);
    // Live demo sends reach only OTP-verified numbers (authorizeJob) and need every budget: per incident and session,
    // per number and day, and the code SMS cap with its pepper.
    if (qualification.live && !qualification.demoLimits) throw new Error('DEMO_MODE live sends require demoLimits');
    if (qualification.live) demoLimits(env);
  }
```
- After the closing `}` of `configuredProvider` (line 20) add:
```ts
/** The explicit demo policy authorizeJob applies, built once at worker start; undefined outside demo mode. */
export function demoDispatch(env: NodeJS.ProcessEnv): DemoDispatch | undefined {
  return env.DEMO_MODE === 'true' ? { enabled: true, alertsPerNumberDaily: demoLimits(env).alertsPerNumberDaily } : undefined;
}
```
- After `const provider = configuredProvider(env);` (line 40) add `  const demo = demoDispatch(env);`.
- Line 49 becomes `    else await consume(ctx, transport, provider!, role as WorkClass, { sms: 2, whatsapp: 2, voice: 2 }, abort.signal, demo);`.

- [ ] **Step 6: Run them and watch them pass.** Run `npm run build && node --test tests/demo-phone.test.mjs tests/demo.test.mjs tests/provider.test.mjs tests/dispatch.test.mjs`. Expected: all pass. The non-demo static-allowlist tests (`dispatch refuses any destination outside a configured allowlist…`, `an empty allowlist refuses…`, `live demo sends stop at the per-incident and per-session budgets…`) still pass, because their recipients are not synthetic and no policy is passed. Then check that nothing still reads the old variable:
```bash
grep -rn "DEMO_LIVE_PHONE" src tests
```
Expected: no output. Then run `npm test` and `npm run typecheck`. Expected: all green.

- [ ] **Step 7: Commit.**
```bash
git add src/notifications/dispatch.ts src/notifications/zavu.ts src/worker.ts tests/demo.test.mjs tests/demo-phone.test.mjs
git commit -m "feat(dispatch): Send demo alerts only to OTP-verified numbers, failing closed"
```

---

### Task 11: Purge the numbers of demo worlds idle for 24 h

**Files:**
- Modify: `src/demo.ts:10` (export the issuer), `src/demo-phone.ts` (import; append), `src/worker.ts` (import; `control` signature and loops; the `control` call), `tests/demo-phone.test.mjs` (append)

FK choice, from `db/migrations/001-core.sql`: `trip_grants.grant_id` and `jobs.grant_id` reference `contact_grants`, and `dispatch_attempts`, `quota_reservations` and `provider_events` hang off `jobs`. Deleting grants would cascade through delivery evidence. So the purge overwrites `contact_grants.phone` (`NOT NULL`) with `''`, which never equals a verified identity phone, so the grant can no longer accept or dispatch.

- [ ] **Step 1: Write the failing tests.** Append to `tests/demo-phone.test.mjs`:

```js
test('the purge leaves no trace of the number of a world idle for 24 h and keeps active worlds', async t => {
  const w = await demoWorld(t);
  const idle = await verifiedWorld(w, phone);
  await authorizeAll(w, idle.jobs, provider({qualification: {...qualification, demoLimits: demoBudget}}), demoPolicy); // frozen payloads carry the number
  w.f.advance(3600000);
  await verifiedWorld(w, other);
  const tables = (await w.f.ctx.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY 1")).rows.map(row => row.table_name);
  async function holding(number) {
    const found = [];
    for (const table of tables) if ((await w.f.ctx.pool.query(`SELECT 1 FROM "${table}" t WHERE t::text LIKE $1 LIMIT 1`, [`%${number.slice(1)}%`])).rowCount) found.push(table);
    return found;
  }
  assert.deepEqual(await holding(phone), ['contact_grants', 'demo_phone_verifications', 'dispatch_attempts', 'identities'], 'positive control: the scan finds the number');
  const {purgeDemoWorlds} = await import('../dist/demo-phone.js');
  w.f.advance(23 * 3600000 + 1); // the idle world was last seen 24 h + 1 ms ago, the other world 23 h + 1 ms ago
  await purgeDemoWorlds(w.f.ctx);
  assert.deepEqual(await holding(phone), [], 'no table holds the idle world\'s number');
  const ids = [idle.world.driver.id, idle.world.family.id, idle.world.colleague.id];
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM identities WHERE id=ANY($1) AND (phone IS NOT NULL OR phone_verified)', [ids])).rows[0].n, 0, 'seeded numbers go too');
  assert.equal((await w.f.ctx.pool.query("SELECT count(*)::int n FROM contact_grants WHERE driver_id=$1 AND phone<>''", [idle.world.driver.id])).rows[0].n, 0);
  assert.equal((await w.f.ctx.pool.query('SELECT count(*)::int n FROM demo_phone_challenges WHERE identity_id=ANY($1)', [ids])).rows[0].n, 0);
  assert.deepEqual(await holding(other), ['contact_grants', 'demo_phone_verifications', 'identities'], 'the active world keeps its number');
  await purgeDemoWorlds(w.f.ctx);
  assert.deepEqual(await holding(other), ['contact_grants', 'demo_phone_verifications', 'identities'], 'a second run changes nothing');
});

test('the control worker runs the purge only in demo mode', async t => {
  const w = await demoWorld(t); const idle = await verifiedWorld(w, phone); w.f.advance(86400001);
  const {control} = await import('../dist/worker.js');
  const phoneOf = async () => (await w.f.ctx.pool.query('SELECT phone FROM identities WHERE id=$1', [idle.world.family.id])).rows[0].phone;
  const quiet = new AbortController(); const off = control(w.f.ctx, {async publish() {}}, provider(), quiet.signal);
  await new Promise(resolve => setTimeout(resolve, 50)); quiet.abort(); await off;
  assert.equal(await phoneOf(), phone);
  const abort = new AbortController(); const running = control(w.f.ctx, {async publish() {}}, provider(), abort.signal, null, demoPolicy);
  for (let i = 0; i < 100 && await phoneOf(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  abort.abort(); await running;
  assert.equal(await phoneOf(), null);
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `npm run build && node --test tests/demo-phone.test.mjs`. Expected FAIL: `TypeError: purgeDemoWorlds is not a function`, and the control test sees the phone unchanged after `control(…, demoPolicy)`.

- [ ] **Step 3: Implement.** In `src/demo.ts`, replace line 10 (`const issuer = 'https://demo.andes.invalid', audience = 'andes-demo', LIFETIME_SECONDS = 7200;`) with:

```ts
export const DEMO_ISSUER = 'https://demo.andes.invalid';
const issuer = DEMO_ISSUER, audience = 'andes-demo', LIFETIME_SECONDS = 7200;
```

In `src/demo-phone.ts`, after the `import { object } from './api/schemas.js';` line, add:

```ts
import { DEMO_ISSUER } from './demo.js';
```

and append to the end of the file:

```ts
/** Run by the control worker every 10 minutes in demo mode: worlds nobody has used for 24 h lose every number they hold. */
export async function purgeDemoWorlds(ctx: Context): Promise<void> {
  await transaction(ctx.pool, async client => {
    // ponytail: rescans every demo identity each run; fine for an event's worth of worlds.
    const ids = (await client.query(`SELECT i.id FROM identities i JOIN (SELECT split_part(subject,':',1) AS world FROM identities WHERE issuer=$1
        GROUP BY 1 HAVING max(last_seen_at)<$2) idle ON split_part(i.subject,':',1)=idle.world WHERE i.issuer=$1`,
    [DEMO_ISSUER, new Date(ctx.clock().getTime() - DAY)])).rows.map(row => row.id as string);
    if (!ids.length) return;
    await client.query('DELETE FROM demo_phone_challenges WHERE identity_id=ANY($1)', [ids]);
    await client.query('DELETE FROM demo_phone_verifications WHERE identity_id=ANY($1)', [ids]);
    await client.query('UPDATE identities SET phone=NULL,phone_verified=false WHERE id=ANY($1) AND (phone IS NOT NULL OR phone_verified)', [ids]);
    // contact_grants.phone is NOT NULL and trip_grants and jobs reference the row, so the number is overwritten, not deleted.
    // An empty destination never matches a verified identity phone, so the grant can no longer be accepted or dispatched.
    await client.query("UPDATE contact_grants SET phone='' WHERE (driver_id=ANY($1) OR contact_id=ANY($1)) AND phone<>''", [ids]);
    // Frozen payloads carry the number until their 24 h evidence window ends; end it now. Destination hashes stay as evidence.
    await client.query('UPDATE dispatch_attempts a SET payload=NULL FROM jobs j WHERE j.id=a.job_id AND j.recipient_id=ANY($1) AND a.payload IS NOT NULL', [ids]);
  });
}
```

In `src/worker.ts`:
- Change the `demo-phone.js` import to `import { DEMO_PREFIX, demoLimits, purgeDemoWorlds } from './demo-phone.js';`.
- Replace the `control` signature line with:
```ts
export async function control(ctx: Context, transport: Transport, provider: Provider | null, signal: AbortSignal, checks: CheckConfig | null = null, demo?: DemoDispatch) {
```
- In `control`, replace the line `...(checks ? [loop(() => checkOnce(ctx, support, checks), checks.sweepMs, signal)] : [])` with:
```ts
    ...(checks ? [loop(() => checkOnce(ctx, support, checks), checks.sweepMs, signal)] : []),
    // Demo worlds idle for 24 h lose their numbers.
    ...(demo?.enabled ? [loop(() => purgeDemoWorlds(ctx), 600000, signal)] : [])
```
- In `startWorker`, change `if (role === 'control') await control(ctx, transport, provider, abort.signal, checks);` to `if (role === 'control') await control(ctx, transport, provider, abort.signal, checks, demo);`.

- [ ] **Step 4: Run them and watch them pass.** Run `npm run build && node --test tests/demo-phone.test.mjs tests/checks.test.mjs tests/dispatch.test.mjs`. Expected: all pass. Then run `npm test` and `npm run typecheck`. Expected: all green.

- [ ] **Step 5: Commit.**
```bash
git add src/demo.ts src/demo-phone.ts src/worker.ts tests/demo-phone.test.mjs
git commit -m "feat(demo): Purge the numbers of demo worlds idle for 24 hours"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/contracts/runtime.md:7,9,40,77,85,137-157`; `docs/contracts/client-read.md:13`; `.env.example:6,42-46`

- [ ] **Step 1: Update `docs/contracts/runtime.md`, bottom up.**

Replace lines 137-157 (from `## Demo mode` up to, but not including, `## Incident data and insights`) with:

```md
## Demo mode

For the judges' demo only. `DEMO_MODE=true` replaces OIDC with an in-process RS256 demo issuer (`src/demo.ts`). Real identity tokens are rejected, and every other route keeps the same JWT, ownership and consent checks. Never enable demo mode on a deployment with real users. Without `DEMO_MODE=true`, none of the routes below exist and dispatch keeps the static `allowedDestinations` rule.

### Session

`POST /v1/demo/session` with `{}` is unauthenticated and needs no Idempotency-Key (a deliberate exception: there is no actor yet). Each call creates an isolated synthetic world:
- a driver and a `colleague` contact with fictional `+1555555010x` numbers;
- a `family` persona with no number (`phone` null, `phone_verified` false) until its contact verifies one by SMS code;
- one accepted map+incident grant, for the colleague. There is no truck and no family grant: the guided journey creates them (`POST /v1/trucks`, `POST /v1/contacts`, then the contact accepts).

It returns 200 `{synthetic:true, expiresInSeconds:7200, expiresAt, tripCountries, driver:{id,token}, family:{id,token}, colleague:{id,token,grantId}}`:
- `expiresAt` is when the tokens expire (ISO 8601).
- `tripCountries` lists the countries that have an entry in the Zavu qualification, live or not, sorted, and `[]` without one. The trip form offers only these. It is not `DEMO_ALLOWED_COUNTRIES`, which only decides which numbers may receive a code.

Keep the tokens in memory and switch personas client-side. The colleague never verifies by SMS, so its alerts always end `unavailable` / `destination_not_allowed` (the *not allowed* row).

### Verifying a contact's own number

Both routes are authenticated (the actor is the token's persona) and need no Idempotency-Key. Errors use the usual `{code}` body.

| Route | Success | Errors |
|---|---|---|
| `POST /v1/demo/phone/start` `{phone}` | 202 `{expiresAt}` | 400 `invalid_phone`, 403 `country_not_allowed`, 429 `rate_limited`, 429 `demo_budget_exhausted`, 503 `demo_sms_disabled` |
| `POST /v1/demo/phone/verify` `{phone, code}` | 200 `{verified:true}` | 400 `invalid_code`, 410 `code_expired`, 429 `too_many_attempts` |

- `start` checks E.164, then that the calling code belongs to a country in `DEMO_ALLOWED_COUNTRIES` (supported: AR, BR, CL, CO, MX, PE, US; `US` covers all of +1).
- `start` sends `Demo de Tándem: tu código es NNNNNN` (6 random digits, no URL) by SMS through the Zavu adapter, on `sms_oneway` when the qualification sets `smsMode:"oneway"`. The code lives 10 minutes.
- Only HMAC-SHA256 values keyed with `DEMO_PHONE_PEPPER` are stored for the number, the IP and the code, in `demo_phone_challenges`. The IP is `request.ip` behind exactly `TRUST_PROXY_HOPS` proxies.
- The caps are checked under one lock before the SMS:
  - `DEMO_OTP_PER_NUMBER_HOURLY` codes per number, in any world, and `DEMO_OTP_PER_IP_HOURLY` per IP, both over a rolling hour (429 `rate_limited`);
  - `DEMO_SMS_DAILY_CAP` code SMS in total per rolling 24 h (429 `demo_budget_exhausted`).
- A request that the provider then refuses still counts and answers 503 `demo_sms_disabled`. An ambiguous provider result answers 202.
- With `ZAVU_LIVE_SEND=false`, `start` answers 503 `demo_sms_disabled` and counts nothing.
- `verify` looks only at the latest code this persona requested for that number, so a code from another persona or world never matches. The comparison runs in constant time.
- Every try counts: after 5 tries, `verify` answers 429 `too_many_attempts`. A matching code is spent at once.
- On success, `verify` writes `demo_phone_verifications(identity_id, phone, verified_at)` and sets this persona's `identities.phone` and `phone_verified=true`, which contact acceptance requires.
- Tests inject a fake sender and a fixed code only in process, through `createApp({demoPhone})`. No environment variable sets a code.

### Live sends in demo mode

With `DEMO_MODE=true` and `ZAVU_LIVE_SEND=true`, the API and workers refuse to start unless:
- the qualification has `demoLimits {perIncident, perSession}`;
- `DEMO_SMS_DAILY_CAP`, `DEMO_ALERTS_PER_NUMBER_DAILY` and `DEMO_PHONE_PEPPER` (32 or more characters) are set.

In demo mode, live or not, every qualification entry `text` must start with `Demo de Tándem`. The approved WhatsApp template must carry that prefix too, which is checked by hand. Alert bodies (`src/notifications/wording.ts`) are Spanish for every trip, pt-BR included, so both voice entries set `voiceLanguage: "es-ES"`.

`authorizeJob` runs these checks before quota or any provider call:
1. **Allowlist, failing closed.** With the worker's demo policy (`{enabled, alertsPerNumberDaily}`, built at startup from `DEMO_MODE`), the static `allowedDestinations` check is replaced: a `demo_phone_verifications` row must exist with `identity_id = grant.contact_id` and `phone = grant.phone`. A synthetic (demo) recipient without that policy is never contacted. Otherwise the job ends `unavailable` / `destination_not_allowed`.
2. **Budgets, under the account lock.** `perIncident` counts attempts per incident and `perSession` per recipient identity. `DEMO_ALERTS_PER_NUMBER_DAILY` counts attempts to the same destination over the last 24 h, across all worlds. Demo mode without `demoLimits` or without the per-number cap ends `unavailable` / `demo_budget_exhausted`.

One rehearsal sends two waves to the family (the check, then the SOS), 3 channels each, so `perIncident`, `perSession` and `DEMO_ALERTS_PER_NUMBER_DAILY` must each be at least 6. There is no `DEMO_LIVE_PHONE`: the operator verifies their own number like anyone else. Personas can invite only personas of their own world (403 `demo_world_boundary`).

### Purge

In demo mode the control worker runs a purge every 10 minutes. A world whose newest `identities.last_seen_at` is older than 24 h loses every number:
- its `demo_phone_challenges` and `demo_phone_verifications` rows are deleted;
- `identities.phone` becomes null and `phone_verified` false;
- `contact_grants.phone` is overwritten with `''`, because the column is `NOT NULL` and `trip_grants` and `jobs` reference the row. An empty destination never matches a verified phone;
- frozen `dispatch_attempts.payload` is cleared.

Destination SHA-256 hashes remain as delivery evidence. Nothing logs a number.

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `DEMO_MODE` | unset | `true` turns on everything in this section |
| `DEMO_ALLOWED_COUNTRIES` | `PE` | Comma list of countries whose numbers may receive a code |
| `DEMO_OTP_PER_NUMBER_HOURLY` | 3 | Codes per number per rolling hour |
| `DEMO_OTP_PER_IP_HOURLY` | 5 | Codes per client IP per rolling hour |
| `DEMO_SMS_DAILY_CAP` | required with live sends | Code SMS per rolling 24 h, all numbers |
| `DEMO_ALERTS_PER_NUMBER_DAILY` | required with live sends | Alert attempts per verified destination per rolling 24 h |
| `DEMO_PHONE_PEPPER` | required with live sends | HMAC key, 32 or more random characters, from the secret manager |

### Limits

- At most 30 worlds per minute per instance (429 `demo_rate_limited`).
- The signing key lives in memory, so tokens end on restart and the demo must run a single instance.
- Numbers are purged after 24 h idle. Other demo rows stay until the database is dropped after the event.
- Abandoned worlds alert nobody. With `DEMO_MODE=true`, the control worker opens a check only if the trip's driver or a current contact made an authenticated request (a `/status` poll counts) within the last `ASK_GRACE_MS`. It escalates the check only if one did after it opened; otherwise the open check is cancelled at its deadline. A closed tab, or tokens that died with a restart, therefore stop all automatic checks. Keep `/status` polling while a demo screen is open. An explicit SOS is never affected.
```

After line 85 (the `entries` bullet) insert:

```md
- Optional `smsMode: "oneway"` when the account's SMS sender is Zavu's one-way kind (channels `["sms_oneway"]`). Internal `sms` then goes out as `sms_oneway`, and send replies and read-back must say `sms_oneway`. Callbacks always report `sms_oneway` as `sms`; correlation still needs the exact message ID, sender and destination.
```

Replace line 77 (the paragraph that starts `Every authorized attempt freezes the provider payload`) with:

```md
Every authorized attempt freezes the provider payload, its SHA-256 hash, destination hash, owner/token and stable provider key before network. The alert summary (`src/notifications/wording.ts`) is Spanish for every trip, pt-BR included. It names the truck label and says what triggered it (SOS, or the missed-check reason). SMS and WhatsApp carry the exact incident UUID (`Incidente <id>.`) so the authenticated recipient can read, acknowledge and report actions for the same episode; the ID grants no access by itself and is not a bearer link. Voice summaries carry no ID, because a call would read it aloud. The summary includes the persisted capture time (HH:MM in the trip time zone), the location age, rounded accuracy and the last latitude/longitude, but only when map access and standing/trip map consent remain valid at authorization. WhatsApp gives the position as a Google Maps link, plus a `CONTACT_APP_URL` view link when that is set. SMS gives it as plain `lat, lon` text and carries no URL at all: Zavu holds an SMS until each exact URL in it is pre-verified through `/v1/urls`, it blocks shorteners, and every alert link is unique. Voice reads the capture time, age and accuracy instead. The existing 120-second freshness bound is synthetic. Without a location, the summary truthfully says `Última ubicación no disponible`. Arrival keeps SOS active while preventing newly authorized payloads from gaining coordinates. Payloads already authorized may finish after revoke/closure. Untrusted raw trip text is never copied, but the driver's truck label is, collapsed to one line and at most 40 characters. WhatsApp places the entire summary in one explicitly configured approved-template variable; text and voice append it to qualified configured text. Incident acknowledgements/actions remain separate from provider acceptance/delivery.
```

After line 40 (the `GET /mapa` row) insert two rows:

```md
| `GET /` and every other non-`/v1` GET | Unauthenticated web app from `web/dist` (`src/api/web.ts`). A path with a known file extension serves that file: `assets/*` is cached `immutable`, other files `no-cache`. Any other path returns `index.html` (`no-store`). Paths that climb out of `web/dist`, and unknown extensions, return 404 `not_found`. Every `/v1` path stays authenticated; an unknown authenticated `/v1` GET is 404 `not_found`. The server fails at startup without `web/dist/index.html`. |
| `POST /v1/demo/phone/start`, `POST /v1/demo/phone/verify` | Demo mode only; see [Demo mode](#demo-mode). |
```

In line 9, replace `createApp({ctx,auth,channelSupport?})` with `createApp({ctx,auth,channelSupport?,callbackConfig?,demo?,demoPhone?,automaticChecks?,webRoot?,trustProxyHops?})`.

At the end of line 7 (the `## Run and identity` paragraph), append:

```md
 Build the web app first (`npm --prefix web ci && npm --prefix web run build`): the API serves `web/dist` and refuses to start without it. `HOST` (default `0.0.0.0`; use `127.0.0.1` behind a local tunnel) sets the listen address. `TRUST_PROXY_HOPS` (default 1, an integer from 0 to 3, never `true`) is the number of proxies in front of the API, so `request.ip` is the address the nearest trusted proxy saw.
```

- [ ] **Step 2: Update `docs/contracts/client-read.md:13`.** Replace `including demo personas and the consented `DEMO_LIVE_PHONE`` with `including demo personas and numbers verified by SMS code in demo mode`.

- [ ] **Step 3: Update `.env.example`.** After line 6 (`PORT=3000`) insert:

```
# 127.0.0.1 behind a local tunnel; the container on AWS needs 0.0.0.0.
# HOST=0.0.0.0
# Proxies in front of the API (cloudflared or the load balancer). Never "true".
# TRUST_PROXY_HOPS=1
```

Replace lines 42-46 (the `DEMO_LIVE_PHONE` block) with:

```
# Judges' demo only: synthetic persona sign-in instead of OIDC (docs/contracts/runtime.md#demo-mode).
# Live sends reach only numbers a contact verified by SMS code in the same demo world.
# DEMO_MODE=true
# DEMO_ALLOWED_COUNTRIES=PE,BR,CL,CO,MX,AR
# DEMO_OTP_PER_NUMBER_HOURLY=3
# DEMO_OTP_PER_IP_HOURLY=5
# Required with DEMO_MODE=true and ZAVU_LIVE_SEND=true (with demoLimits in ZAVU_QUALIFICATION_JSON, each at least 6):
# DEMO_SMS_DAILY_CAP=40
# DEMO_ALERTS_PER_NUMBER_DAILY=6
# DEMO_PHONE_PEPPER= (32+ random characters from your secret manager)
```

- [ ] **Step 4: Verify.** Run:
```bash
grep -rn "DEMO_LIVE_PHONE" src tests docs/contracts .env.example
npm test
```
Expected: no grep output, and every test passes.

- [ ] **Step 5: Commit.**
```bash
git add docs/contracts/runtime.md docs/contracts/client-read.md .env.example
git commit -m "docs(contracts): Document the phone demo backend"
```

---

## Self-review against the spec

- §1 single origin, auth exemptions, no new dependency, no CORS, the Dockerfile builds the web app: Tasks 1 and 3. `trustProxy` is exactly one hop and `HOST` is configurable: Task 2. The `deploy.sh` fixes are Plan C.
- §4 session without truck or family grant, `tripCountries`, family phone null, colleague *not allowed*: Task 6. OTP tables and routes, caps, pepper, constant-time compare, 503 without counting: Tasks 7–9. The dynamic allowlist replaces the static one, policy at worker start, startup requirements, per-number cap, no `DEMO_LIVE_PHONE`, prefix check: Task 10. Purge: Task 11. Production unchanged: the tests `without demo mode the phone routes do not exist` and `production keeps its own texts`, and the static-allowlist tests stay green.
- §5 configuration table and minimum budgets of 6: Task 12. Coordinator findings: SMS without URLs and voice without IDs (Task 5), `sms_oneway` on send reply, read-back and callbacks (Task 4), Spanish bodies with `es-ES` voice (Task 12).
- §6 no phones in responses or logs (Task 6 tests, HMAC-only storage in Task 8), fail-closed (Task 10), three cap layers (Tasks 8 and 10), 24 h purge (Task 11), 30 sessions per minute kept (Task 6).
- §7 backend tests: every listed case maps to a test above. The CI end-to-end browser test is Plan B; it uses `createApp({demo, demoPhone, webRoot})` in process.
