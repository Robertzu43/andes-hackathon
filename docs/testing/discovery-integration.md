# Discovery integration

This child of the typed-client/backend seam stages lane41's additive read routes
from `748d30c6e6c595fd1a2c2c648a045750de3dd9c8`. Its route source, two-line
application mount, contract and five route tests retain their original Git blobs.
The dispatch expiry correction and accepted typed client remain unchanged.

`tests/discovery-integration.test.mjs` exercises the mounted API over native
loopback HTTP with signed synthetic JWTs and isolated PostgreSQL schemas. It uses
the accepted client's existing write methods, then reads the new discovery routes
directly over HTTP. It does not invent client discovery methods while lane45's
adaptation is under review.

The cases cover authentication and `no-store` on all five reads, persisted typed
writes appearing in bootstrap and focused lists, signed owner isolation even with
an owner query hint, exclusion of draft text/coordinates/incident IDs, and a fresh
read reflecting contact revocation and trip closure. Arrival still leaves the
separate incident active. These are local software checks; they establish no
browser, external OIDC, device, provider, human or product outcome evidence.

Use the disposable database setup in [integrated-backend.md](integrated-backend.md),
then run `npm run typecheck`, `npm run typecheck:client-api` and `npm run test:all`.
The existing test glob includes both route and HTTP integration suites. The source
PR and this combined candidate each require independent review before integration.
