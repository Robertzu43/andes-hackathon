# Independent typed-client/backend seam review

Candidate: `ecf3f111c1eb3cf3d6d85f83e084dc95ef665c1f`,
[PR64](https://github.com/Bimbi-Dev/andes-hackathon/pull/64), stacked on accepted
backend correction `5591c9b`. Verdict: **ACCEPT for this bounded integration**.
No Q48 blocking finding remains. Required Robert review/confirmation and the
parent PR's merge gates remain separate.

## Source and integration checks

All ten library/contract files match accepted PR59 source
`78efad0a207e98cc44336a03ba6af9fc0c1d2901` byte for byte; the
[blob receipt](results/ecf3f11/library-blobs.json) preserves their hashes.
Production `src/`, migrations, package lock and existing scripts are unchanged
against the accepted parent. This review imports no production change.

The root test glob includes the three new native-fetch integration cases.
`test:all` additionally runs the client's 48 tests; the explicit client
typecheck runs strict NodeNext and ESNext/Bundler configurations. CI forwards
both. The loopback server uses the real API factory, signed synthetic JWTs and
isolated PostgreSQL schemas; it does not replace API routes with a mock server.

Inspected all three added contract tests and root script/CI/documentation changes.
They exercise real persistence and decoding, explicit confirmation, original
idempotent response versus changed-content conflict, ownership denial, invalid
JWT session clearing, source age, current-consent revocation, and independent
incident acknowledgement/action/arrival/resolution. Existing module acceptance
is provenance evidence; the new integration was tested independently.

## Independent live-HTTP race controls

`client-seam.test.mjs` adds two separate reviewer probes using public client
exports, real native HTTP/JWT/PostgreSQL and controlled response withholding:

1. Allow the server to commit a truck creation and fully return HTTP, then
   withhold the response from the client. The client returns network/unknown and
   makes one attempt. A caller's explicit same-key replay returns the one stored
   truck; changed content with that key gets a real rejected 409. No automatic
   replay, replacement key or duplicate row appears.
2. Hold an actual owner-only trip response after it has arrived over HTTP,
   deliberately ignore transport abort, and replace the memory session with a
   separately signed stranger identity. The old response fails `session_changed`
   instead of exposing its row. A new request gets the backend's real 403 while
   preserving the valid replacement session.

Both pass. These controls test the actual seam rather than assuming that the
module's earlier simulated-transport tests establish backend compatibility.

## Verification

Node 24.17.0, Python 3.14.7, PostgreSQL 16.14, dedicated Q48 database cluster with
unique disposable test schemas. No provider, AWS or external identity calls.

| Command | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run typecheck:client-api` | both strict module configurations pass |
| `npm run test:all` | 234 tests pass (56 backend/contract + 31 recorder + 99 Python + 48 client); 50/50 scenarios pass |
| `node --test --test-reporter=tap review-probes/client-seam.test.mjs` | 2/2 independent controls pass |
| Parent-to-candidate diff/whitespace checks | pass; production source/SQL/lock unchanged |

Raw [combined checks](results/ecf3f11/combined.txt),
[independent output](results/ecf3f11/independent.txt),
[strict client checks](results/ecf3f11/typecheck-client.txt), and
[command receipt](results/ecf3f11/checks.json) are retained. Output paths and
whitespace are normalized; assertion results are preserved.

This is local native-HTTP compatibility evidence. Browser CORS/proxy, actual
external OIDC, UI state/storage cleanup, later discovery routes and real
device/provider/human outcomes remain outside this candidate. No merge,
repository setting change, production source edit or issue closure occurred.
