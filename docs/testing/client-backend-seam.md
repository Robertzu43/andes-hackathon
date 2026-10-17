# Typed client against the executable backend

This child integration branch starts at runtime correction
`5591c9b55fe7f4505e36ccee96d27aa913e0debf` (draft PR61). That branch remains
frozen for its separate review. The ten lane45 library/contract files are copied
unchanged from independently accepted
`78efad0a207e98cc44336a03ba6af9fc0c1d2901` (PR59); no frontend foundation,
package, screen or production login is introduced.

With the [isolated backend database](integrated-backend.md) configured:

```sh
npm run typecheck:client-api
npm run test:all
```

The first command runs the pinned TypeScript compiler in both NodeNext and
ESNext/Bundler modes. `test:all` includes the backend and offline toolkit checks,
the client author's tests, and `tests/client-backend.test.mjs`. The latter uses
the client's public exports with native fetch, real loopback HTTP on allocated
ports, signed synthetic identities and actual isolated PostgreSQL schemas.

The three integration cases check real response decoding and contracts:

- Persisted identity/draft/trip shapes, explicit confirmation, same-key writes,
  changed-content conflicts, cross-owner denial, and session invalidation after
  an invalid JWT receives 401.
- Accepted trip consent, unavailable/fresh/stale snapshots with distinct source
  and read times, and denied contact reads immediately after trip revocation.
- Minimal incident reads, separate acknowledgement and reported action,
  arrival without incident resolution, and explicit driver resolution.

Each test closes its API and drops only its own synthetic schema. It sends no
provider messages. Credentials exist only in the test's memory; the trusted
signed-key test injection is not an implemented production sign-in flow. These
checks do not prove browser CORS/proxy behavior, real external OIDC, UI privacy
cleanup, phone capture or human outcomes.

The production API remains unchanged by this seam. Discovery/list adaptation
waits for lane41's published read contract. Robert owns forthcoming `/status`
and `/sharing`; this branch invents neither route. Lane49 still owns `web/`'s
foundation/runtime and future screens consume the same reviewed library. The
HTTP/restart harness from lane46 remains separate pending review of its latest
entry point. PR59 and this integration draft still require their applicable
review gates before merge.

Author verification on Node 24.17.0, Python 3.14.7 and isolated PostgreSQL 16.14:
both strict TypeScript configurations pass; `npm run test:all` passes 234 tests
(56 backend/contract, 31 recorder, 99 Python toolkit and 48 client) plus 50 check-in
scenarios, with no failures or skips. All ten accepted library/contract blobs
still match their frozen source after testing. These integration additions
await independent review; the source library's earlier acceptance does not
automatically approve this new seam.
