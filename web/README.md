# Tándem web app

React 19 + Vite. Node 24–26. Its package and lockfile are separate from the backend.

```sh
npm ci --prefix web
npm --prefix web test            # strict build + node --test tests/*/*.test.mjs
npm --prefix web run test:phone  # builds web + backend, drives Chrome through the demo against the real API and an owned PostgreSQL
ANDES_API_PROXY_TARGET=http://127.0.0.1:<api-port> npm --prefix web run dev
```

`test:phone` needs PostgreSQL 15+ (`pg_config` or `APP_INTEGRATION_PG_BIN`) and Chrome (`google-chrome` or `ANDES_CHROME_BINARY`).

- **API target.** `dev` and `preview` proxy only `/v1` to `ANDES_API_PROXY_TARGET`, which must be a credential-free loopback origin. Without it, `/v1` answers `503 {code:"api_unconfigured"}` instead of SPA HTML. Dotenv files never set the target.
- **Ports.** `ANDES_WEB_PORT` picks the port; the default `0` lets the OS choose one, and the URL is printed.
- **Metadata.** `ANDES_PUBLIC_ORIGIN` sets the share-image origin at build time.
- **Test hook.** In development only, `ANDES_ENABLE_TEST_HOOKS=1` exposes `window.__ANDES_TEST_MOUNT__` for the app-integration browser seam. Production builds compile it out.

`src/main.tsx` mounts the driver screens and the contact routes on one in-memory demo session (`POST /v1/demo/session`, no OTP). Whether an SOS reaches a real phone is the backend's decision (`ZAVU_LIVE_SEND` and the `DEMO_LIVE_PHONE` allowlist); the client gets no live-send signal. The typed API client lives in `src/lib/api/` ([boundary](../docs/client/api-boundary.md)); tokens are in `src/styles/tokens.css`.
