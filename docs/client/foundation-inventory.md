# Shared browser foundation: source inventory

Inventory date: 2026-10-17. Backend source: `codex/aws-durable-backend` at **`ebc8fb1d36f441ef012ca585201cefabf61383d6`**, fetched before inspection. Foundation branch: `sebasbimbi/feat/andes-web-foundation`, starting at that exact commit. Earlier contact, monitoring and review-policy branches are preserved.

This checkpoint records technical feasibility and API gaps. It supplies no approved visual system, browser route map, runnable web app or integration proof. Brain owns the product/route/verified Design Contract release; UI implementation waits for that release. All app routes are private task/utility surfaces, not marketing/search pages.

## Compatible runtime proposal

The [backend package](../../package.json) is ESM TypeScript 5.9.3 with `node >=24 <27`; the locally available Node 24.17.0 fits it. Root [tsconfig.json](../../tsconfig.json) includes only `src/**/*.ts`. The root backend package, migrations and CI stay owned by component 44. The backend snapshot has no `web/` package or existing browser design system.

Recommend one isolated `web/` React + TypeScript + Vite package. [React's build-tool guidance](https://react.dev/learn/build-a-react-app-from-scratch) supports a Vite `react-ts` setup, and [Vite's runtime guidance](https://vite.dev/guide/) permits this Node runtime. A separate server-rendering framework is unnecessary for the currently assigned private task UI. Versions, lockfile and actual build evidence will be recorded when the foundation is implemented; this proposal is not an install claim.

- Keep `web/package.*` and browser dependencies isolated; no root dependency or CI edits by this lane.
- Proposed browser compiler: strict TypeScript, `moduleResolution: Bundler`, `noEmit`, `allowImportingTsExtensions`, JSX through React. Explicit `.ts` source imports support framework-neutral modules tested by Node 24's native type stripping; `.mjs` controllers are compatible too. Do not import backend Node/SQL/provider modules into browser bundles.
- Use a same-origin `/v1` development proxy to an explicit lane-owned local API target. [The Fastify application](../../src/api/app.ts) has no CORS registration. No port or database is claimed by this inventory; use the registry and verify ownership before serving. Do not reuse the example Compose ports blindly.
- API/session transport belongs to component 45. Consume its in-memory bearer/session boundary and typed operations; do not invent login, store tokens in browser persistence, auto-refresh, or blindly replay ambiguous writes.
- Global locale, navigation, fonts, tokens and primitives belong to the shared foundation, after contract release. Driver/contact lanes consume them; no independent visual systems or shared-package edits.

## Actual HTTP surface at this SHA

All POST operations except the provider callback need a caller-supplied `Idempotency-Key`. Authenticated calls require a verified OIDC bearer. Successful POSTs return 200; API errors retain `{code}` and status distinctions. See the [runtime contract](../contracts/runtime.md) and [mutation boundary](../../src/api/mutations.ts). Browser route names remain pending Brain's approved map.

| Existing HTTP operation | Source / current capability |
| --- | --- |
| `GET /health` | [app.ts](../../src/api/app.ts), unauthenticated database readiness |
| `GET /v1/me` | [app.ts](../../src/api/app.ts), authenticated identity `{id}`; not a profile/login API |
| `POST /v1/trucks` | [trip routes](../../src/trips/routes.ts), create an owned truck label |
| `POST /v1/trip-drafts` | Trip routes, retain text and optional explicitly corrected fields; audio is unsupported |
| `POST /v1/trip-drafts/:id/confirm` | Trip routes, explicit confirmation with owned truck, regional fields and accepted grants |
| `GET /v1/trips/:id` | Trip routes, owner-only persisted trip row, SQL field names |
| `POST /v1/trips/:id/commands` | Trip routes, `arrived/cancel/pause/resume/checkin_ok/rest_report`; reports never prove wellbeing or resolve SOS |
| `POST /v1/contacts` | [contact routes](../../src/contacts/routes.ts), pending invitation to an already registered identity, no message sent |
| `POST /v1/contacts/:id/accept` | Contact routes, verified target phone, scope may narrow; no broadening |
| `POST /v1/contacts/:id/revoke` | Contact routes, standing revocation, also affects trip grants/pending work |
| `POST /v1/trips/:id/contacts/:grantId/revoke` | Contact routes, trip-specific revocation |
| `POST /v1/trips/:id/locations` | [location routes](../../src/location/routes.ts), owner upload of 1–100 observations; source capture time retained |
| `GET /v1/trips/:id/snapshot` | Location routes, owner/accepted map contact; `capturedAt`, `receivedAt`, `readAt`, age and fresh/stale/unavailable remain separate |
| `POST /v1/trips/:id/sos` | [incident routes](../../src/incidents/routes.ts), one active attributed episode, group capability unavailable |
| `GET /v1/incidents/:id` | Incident routes, known incident ID and current owner/contact authorization; limited incident facts, including after arrival |
| `POST /v1/incidents/:id/acknowledgements` | Incident routes, contact acknowledgement; does not establish action/help or resolve |
| `POST /v1/incidents/:id/actions` | Incident routes, attributed reported action |
| `POST /v1/incidents/:id/resolve` | Incident routes, owner-only explicit resolution; independent of trip/map closure |
| `POST /v1/callbacks/zavu` | [callback route](../../src/notifications/callback.ts), server/provider-only HMAC boundary, never a browser operation |

Snapshot freshness uses a synthetic 120-second engineering bound. It does not certify phone availability or fill a missing interval. Delayed receipt never refreshes capture time. Arrival stops new map access while incident response can continue with incident consent. Default provider sending is disabled; no browser control may silently enable it.

## Missing contracts sent to Brain for components 41/45

| Gap in inspected source | Owner / bounded integration consequence |
| --- | --- |
| Owned truck, standing contact and active/recent trip lists; owner bootstrap/profile | Component 41's assigned additive reads. Until published, a reload cannot recover these collections through the present API. Do not guess routes or response fields. |
| Pending invitation and contact-authorized trip/incident discovery | Coordinate 41/45/API owner. Existing reads require known IDs. An incident UUID grants no access and is not a bearer link. |
| Browser sign-in/provider registration/logout and token acquisition | [auth.ts](../../src/auth.ts) verifies trusted issuer/audience/JWKS tokens only. Component 45 owns secure session transport; component 46 can supply explicitly synthetic local auth fixtures. No production sign-in is established. |
| Last driver response, agreed contact deadline, per-job notification status reads | Coordinate #18/#21 with Robert and 41/45. SQL/command writes and dispatch facts are not themselves browser read contracts. The earlier #22 projection inputs are provisional and must not be mapped to invented endpoints. |
| API target, isolated backend fixture process and browser fixture injection | Components 44/46 own backend runtime. Configure an owned loopback target and expose no credentials in client env/config. Demo and real integration modes must be visibly distinct. |
| Approved utility routes, shared component vocabulary, design/brand/font rules and complete evidence scope | Brain release required before UI, router/navigation or visual-token implementation. Consumer lanes 50/51 and independent reviewer 52 need the same exact foundation SHA and contract. |

## Ownership and handoff

49: shared runtime/package, global i18n/navigation, approved primitives/tokens/fonts/assets. 45: `web/src/lib/api/**` and API/session tests. 50: driver feature modules. 51: trusted-contact feature modules. 52: independent whole-app acceptance. 41: additive backend reads. 44: root runtime/CI and sole integration/merge. 46: isolated backend test/demo runtime.

UI acceptance will cover actual approved routes at desktop/mobile and Spanish/Brazilian Portuguese contexts, keyboard/focus, long text, loading/empty/error/permission/auth states, reduced motion and numeric overflow. This document contains no completed render, test suite, browser capture, independent acceptance, device observation or human comprehension result. No public deployment, live sends, spending, recruitment or real trip collection occurred. Existing safety/evidence gates and reciprocal review requirements remain open.
