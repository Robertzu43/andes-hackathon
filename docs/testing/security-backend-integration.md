# Published security backend integration

This isolated candidate combines accepted client/backend PR64
`ecf3f111c1eb3cf3d6d85f83e084dc95ef665c1f` with Robert's published PR74
`4c138ca1d00742400a850cd72b0888cc59260a36`. Both histories are retained.
The reviewed `5591c9b` expiry fix and its six regressions remain present; the
new alert wording is merged alongside that fix. Robert's branch is unchanged.

`tests/security-integration.test.mjs` uses native loopback HTTP, signed synthetic
JWTs and isolated PostgreSQL schemas. Existing accepted typed-client writes and
incident decoders are exercised against the new source, with direct HTTP for the
new status/sharing routes until lane45 publishes reviewed bindings. The cases
preserve the difference between a sharing report, actual capture stop and consent
revocation, and between check/OK/pause/arrival and explicit SOS resolution.

Run the disposable setup in [integrated-backend.md](integrated-backend.md), then
`npm run typecheck`, `npm run typecheck:client-api` and `npm run test:all`.
No new environment setting is needed for these tests. This integration does not
enable demo mode, sweeper timing settings, live sends, infrastructure or deployment
scripts. The inherited synthetic tests remain engineering evidence, not an
approved cadence or policy.

PR74's original independent auth/privacy and race reviews and this combined
candidate's review are separate gates. PR65/68's read-consistency finding remains
held, so those reads are excluded here. Frontend/controller/browser integration,
new source-bound producer receipts and contextual-policy decisions remain separate
work; old `5591c9b` receipts must not be relabelled as proof for this new source.
