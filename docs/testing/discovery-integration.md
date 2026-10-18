# Discovery integration

`tests/discovery-integration.test.mjs` exercises the five owner catalog reads in
[`docs/contracts/client-read.md`](../contracts/client-read.md) over native
loopback HTTP, with signed synthetic JWTs and an isolated PostgreSQL schema. The
route-level contract tests in `tests/client-read.test.mjs` use `inject`; this file
adds the real listener, the shared typed client's write methods, and these checks:

- missing and badly signed bearer tokens get 401, and every read sends
  `Cache-Control: no-store`;
- trucks, an accepted contact, a confirmed trip, locations and an SOS written
  through the typed client appear in bootstrap and in the focused lists;
- no catalog response contains a phone (driver, contact or `"phone"` key), draft
  text, coordinates, incident IDs or another owner's truck;
- a caller-supplied `?driverId=` hint cannot replace the signed identity;
- a fresh read reflects contact revocation and arrival, the separate incident
  stays active, and the revoked contact's snapshot read returns 403.

Phones come from the fixture's fictional `+1-555-01xx` values; the invite uses
the contact's own token phone, as the runtime requires. These are local software
checks, not browser, external OIDC, device, provider or human evidence.

Run with a disposable database: `TEST_DATABASE_URL=... npm test`.
