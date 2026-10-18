# Typed client against the executable backend

`tests/client-backend.test.mjs` runs the typed client on `main`
(`web/src/lib/api`, from #59 and #81) against the real backend. There is one
client: this test imports it and keeps no copy. It uses the client's public
exports with native fetch over loopback HTTP on an allocated port, signed
synthetic identities and an isolated PostgreSQL schema per test.

With the [isolated backend database](integrated-backend.md) configured
(`TEST_DATABASE_URL`), `npm test` runs it with the other backend tests. The
client's own unit tests and its NodeNext and ESNext/Bundler type checks run in
the CI `web` job, so a web type error cannot skip the backend tests.

The three cases check real decoding and exact rejections. Each rejection
asserts the error `kind`, HTTP `status`, server `code` and write `outcome`:

- Persisted identity, truck, draft and trip shapes. A same-key replay returns
  the original row; changed content is 409 `idempotency_conflict`; confirming
  an incomplete draft is 409 `draft_incomplete`; a stranger's trip read is 403
  `forbidden`; an invalid JWT is 401 and ends the session.
- Accepted trip consent, then unavailable, fresh and stale snapshots with
  distinct source and read times. After trip revocation the contact's read is
  403 `forbidden` and its session stays valid.
- Incident read, separate acknowledgement and reported action, arrival without
  incident resolution (the contact's map read is then 403 `map_inactive`), and
  explicit driver resolution.

`MemorySession` credentials take `expiresAt` in epoch milliseconds, like
`Date.now()`. An OIDC `exp` claim is in seconds, so multiply it by 1000.

Each test closes its API and drops only its own schema. It sends no provider
messages, and all phone numbers are fictional. The signed-key injection is a
test seam, not a production sign-in flow. These checks do not prove browser
CORS or proxy behavior, real external OIDC, UI privacy cleanup, phone capture
or human outcomes.
