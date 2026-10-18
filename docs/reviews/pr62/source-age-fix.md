# PR62 source-age helper: independent fix confirmation

**Q59 FIX CONFIRMED, narrow original source-age P2 only**, at
`1fd365ee7805cd83b2b1a1706973788dea6f805e`, against baseline
`e2c1e677cf3ec3fa9c7f91529b082ab5b8ff91e6`.
Original [finding5560699766](https://github.com/Bimbi-Dev/andes-hackathon/pull/62#pullrequestreview-5560699766)
remains historical. This does not accept the whole contact UI, PR74, typed
transport or product journey; original reviewer43 confirmation remains separate.

The production change removes client nowMs and all server/client clock subtraction
from locationAge. It returns raw ageMs, serverFreshnessAtRead and readAt, adding
asOf:'server-read', live:false and currentAuthorization:'requires-server-check'.
An aligned clock no longer implies a current-age estimate: the example returns
120000ms at the server read, not240000ms “now”. The label states that distinction.
This is the accepted as-of-read alternative requested by the original finding,
not an always-unknown workaround or a new projection.

Node24.17.0 independent verification:

- The immutable16d51a1 reproducer is unchanged (SHA-256 in the raw receipt). It
  reproduces240000/180000/300000/150000ms and null future-capture age on the olde2c
  archive. Its hardcoded21cd output tag is retained as provenance; the actual
  executed source archive is separately recorded ase2c.
- That exact original probe exits1 at the fixed head for the intended mismatch:
  old240000 current-age expectation versus raw120000 as-of-read. This expected
  red result is preserved, not reported as a failed fix or erased counterexample.
- Eight independent contract controls pass: aligned/behind/ahead/rollback/
  non-finite legacy clock arguments, backend-accepted+300ms capture, unavailable
  age and stale age. Raw source facts/readAt are unchanged, input stays immutable,
  live remains false and current authorization still requires a server check.
- The author's unchanged eight new regression tests fail8/8 against olde2c and
  pass with the fixed source. The existing focused contact/privacy suite passes
  **30/30**, including those eight tests; it is not counted again as another30.
- Strict TypeScript5.9.3 passes the declared compile-only surface. Removing only
  the expect-error directive in a disposable caller copy yields expectedTS2554
  for passing a second clock argument. No compiler/package was installed.
- All six changed-file archive blobs remain identical to the reviewed commit.
  Full discussion/reviews/inline were refreshed; no additional human finding was
  ignored. Whitespace checks pass.

[source-age-fix.json](source-age-fix.json) contains raw observations, control
outcomes, exact archive/probe fingerprints and compiler diagnostics.
[old-regression-red.json](old-regression-red.json) (original TAP bytes as an exact
UTF-8 JSON string with SHA-256) and
[fixed-contact-privacy.tap](fixed-contact-privacy.tap) retain raw test output.

The current UI already renders raw age/freshness with explicit ES/PT-BR as-of-read
labels and does not call this helper; that counterexample is retained. No browser,
SQL/authentication, device or broad UI requalification was performed. Prior UI
evidence stays at its own e2c head. No merge, review dismissal, product issue
closure, live provider, participant notification or deployment was performed.
