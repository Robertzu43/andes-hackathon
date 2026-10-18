# Security backend integration

`tests/security-integration.test.mjs` runs the security-check routes in
[`docs/contracts/runtime.md`](../contracts/runtime.md) over native loopback HTTP,
with signed synthetic JWTs, an isolated PostgreSQL schema and the shared typed
client for the existing writes. The route-level tests in `tests/checks.test.mjs`
use `inject`; this file adds the real listener and these checks:

- `POST /v1/trips/:id/sharing` is owner-only, replays an identical request under
  the same idempotency key, rejects that key with a different body (409), and
  rejects reports after arrival;
- a sharing report neither revokes consent nor stops location ingestion: the
  contact's snapshot stays fresh;
- `GET /v1/trips/:id/status` sends `Cache-Control: no-store`, returns no
  coordinates or phones, refuses a stranger, and drops location once the trip ends;
- typed SOS, pause, OK, acknowledgement, arrival and resolution agree with the
  status projection: arrival leaves the SOS active until the driver resolves it.

The sweep clock fix (a check opened after waiting for the trip lock keeps its full
grace window) is main's `27e4f94`, covered by its regression test in
`tests/checks.test.mjs`. Phones come from the fixture's fictional `+1-555-01xx`
values. No demo, sweeper timing, live-send or deployment setting is enabled.
These are local software checks, not browser, device, provider or human evidence.

Run with a disposable database: `TEST_DATABASE_URL=... npm test`.
