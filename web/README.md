# ANDES shared browser foundation

Use **Node 24–26** (verified locally on 24.17.0). This package and lockfile are isolated from the backend. From the repository root:

```sh
npm ci --prefix web
npm --prefix web run build
npm --prefix web test
npm --prefix web run dev
```

The default port is `0`: the server selects an available loopback port and prints the actual URL. This avoids changing persistent Codus port assignments. `ANDES_WEB_PORT` may explicitly select an already owned local port. This lane's observed preview was `http://127.0.0.1:59060`; it is local verification evidence, not a stable production domain. No server, DB, identity provider or notification worker is started by the web package.

## API and session seam

Set `ANDES_API_PROXY_TARGET` to the actual credential-free loopback origin of an owned API/fixture process, including its port. Both `dev` and **production-build `preview`** proxy `/v1` without rewriting paths. Without a target, both return JSON `503 {code:"api_unconfigured"}` for `/v1` instead of serving SPA HTML. Tests exercise actual preview sockets, status codes and idempotency headers against a synthetic HTTP fixture; they do not establish real backend authentication or PostgreSQL integration. Components 44/46 own the real local backend/runtime seam.

```sh
ANDES_API_PROXY_TARGET=http://127.0.0.1:YOUR_OWNED_API_PORT npm --prefix web run dev
ANDES_API_PROXY_TARGET=http://127.0.0.1:YOUR_OWNED_API_PORT npm --prefix web run preview
```

`ANDES_PUBLIC_ORIGIN` supplies an explicit local/release origin for share-image metadata during `build`. No production origin is invented. The app's metadata is generic/noindex, with no route IDs, coordinates, participant names or incident facts. Actual deployment/reverse-proxy configuration remains component 44's work; Vite preview is a local build-verification server.

`SessionGateway` and `SessionSnapshot` are exported from `src/foundation/index.ts`. The gateway exposes stable token-free snapshots (`state`, `mode`), subscription, optional `begin(): Promise<void>` and `end(): void`. Credential storage and actual `/v1/me` verification belong to component 45's memory session/API adapter. `authenticated` requires real server verification. The foundation does not acquire tokens, implement production login, persist credentials or auto-refresh/replay writes. Its default `/session` honestly shows unconfigured access and a disabled Continue action.

For explicitly local browser tests only, `ANDES_ENABLE_TEST_HOOKS=1` during **development** exposes `window.__ANDES_TEST_MOUNT__(FoundationOptions)`. A fixture can inject the API-owned gateway and feature components; it still needs valid server authorization. The hook carries no token API itself and is compiled out of production. Never put credentials in Vite environment variables. Test component pages below have no authentication or external transport and must not be described as signed-backend evidence.

## Shared exports and ownership

`src/foundation/index.ts` exports:

- `FoundationRoot({routes?, session?, initialLocale?})`, `FoundationApp`, `AppShell`, `FeatureRoutes`, `FeatureRouteProps`. A feature registry maps the approved route ID to a React component. Each receives validated `params`; keep one page H1. Do not nest another shell, router or language provider.
- `useI18n()` → `{locale, setLocale, t}`, `useMessages(featureDictionary)`, `Locale = 'es' | 'pt-BR'`. Submit feature-local ES/PT-BR dictionaries in your own feature path and pass translated strings to controls. Only the explicit language preference persists, under `andes.locale`; it never chooses trip country/timezone.
- `PrimaryAction`, `ActionGroup`, `Field`, `SelectField`, `ConsentScope`, `TripIdentity`, `FactRow`, `AttributedUpdate`, `AsyncState`, `EmptyState`, `ErrorRecovery`, `PermissionState`, `HomeLink`, `Brand`.
- `routeDefinitions`, `routePath`, `validRouteParams`. The 12 utility patterns match the released map; UUID route parameters are validated. Route titles are generic and append the brand once. No API route is invented by the browser router.

Controls accept ordinary named props/translated strings. Fields retain caller-controlled values and connect error/hint descriptions. Busy actions remain focusable with `aria-disabled` and suppress new clicks; feature controllers must also own write deduplication/idempotency and ambiguous-write handling. `FactRow` displays provided values/source/timestamp/age labels, not inferred freshness. Display timestamps explicitly use UTC; this never sets a trip's timezone or moves an agreement. No browser tick owns a deadline and the parked PR #53 projection is not imported.

Tokens are in `src/styles/tokens.css`: `--canvas`, `--surface`, `--ink`, `--muted`, `--primary`, `--on-primary`, `--warning`, `--danger`, `--border`, `--font-ui`. They are exact OKLCH conversions of the approved identity colors. Respect the accent allowance and 44px/56px control targets. System UI is the deliberate licensed platform-font choice; no external font request or second display family is needed.

49 owns the package/lock, entry, shared foundation/styles, global route/localisation and brand files. 45 owns API/session transport; 50 driver routes; 51 contact/privacy routes. 53/54/55 own optional Hairline/Anatomy visual modules and host; `@lucasmarkes/hairline` is pinned to **0.5.1** (MIT, React >=18 peer), and currently adds no code to the base bundle. Consume optional visuals lazily; their failure must not hide or disable task actions. No new illustration-only routes or live telemetry claims. Only component 44 integrates/merges after review.

## What is runnable now

The shared shell, generic metadata, router, locale choice, controls and session UI are runnable. Feature routes are explicit unavailable placeholders until their owners provide components; this is not a complete driver/contact journey. No fabricated accounts, statuses, delivery or working login are supplied.

Development-only component inspection pages:

- `/tests/fixtures/preview.html`: labelled ES/PT-BR fact rows, attributed updates, field validation, consent, loading/empty/error/permission/long content, and a synthetic save with no transport.
- `/tests/fixtures/session.html`: labelled token-free simulation of unconfigured, signed-out, connecting, authenticated, expired and error UI. It does not sign in to an API.

These HTML entries and the optional mount hook are absent from the default production build. `npm test` expects a preceding build for production-preview tests. Its loopback fixture servers close after each test. The brand set contains exact vector geometry, 16/32/48 RGBA favicon entries, 512px app icon, 180px Apple icon and generic 1200×630 share image.

Builder checks are provisional. Independent component 52 owns full app acceptance; component 56 owns optional visual acceptance. Physical-device capability, human comprehension, live-provider delivery, public deployment and issue evidence gates remain open. Private product/design/process documents stay outside served assets.
