# Insights stack · AI technical review (Codex Q58)

**FIX on PR80 exact `b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8`.** This is an independent engineering review of Robert's code, not human evidence, privacy qualification or permission to merge/deploy. Scope: aggregation, incident/report labels, report budget, hourly cache and time-window behavior. Q43 owns public auth/privacy review; Q44 owns integration.

## Exact sources and ancestry

| PR | Head reviewed | Disposition |
| --- | --- | --- |
| 76 | `05cf907e0e27c4f1a7f6756740222207bdcc7663` | Contains the earlier Part 2 implementation. Changes after shared base `3a62f1c` are `docs/HACKATHON.md` only. Does not contain PR77/80; no full-stack ACCEPT |
| 77 | `62ee06cc761d2f94e88b6a66ec1dd444e263c78a` | Bounded AI ACCEPT for status label and demo-sign-in selection: three focused tests pass on its own archive. Its app/status blobs match final PR80; no whole-stack/human approval |
| 80 | `b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8` | Contains exact PR77 as an ancestor; FIX for the three findings below |
| 83 | `b95ff267d297d1fe1f27fa8b016940996690691c` | Contains PR76, but neither PR77 nor PR80 is an ancestor. Dependency handoff only; no duplicate whole-baseline run or approval |

Robert's [recorded acceptance of verified-account collusion and hourly change inference](https://github.com/Bimbi-Dev/andes-hackathon/pull/76#issuecomment-6243414623) is preserved. These are accepted demo limitations, not new findings. The cases below concern additional implementation behavior.

## P2 · Concurrent reports bypass the five-per-day budget

Source: [report count and insert](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/src/insights/routes.ts#L72), with [per-idempotency-key advisory locking](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/src/api/mutations.ts#L19).

Starting with four reports from one identity, send two simultaneous reports with different idempotency keys. Both real PostgreSQL count queries see four; both requests return 200 and six rows persist. The probe synchronises only after real SQL returns each count; it does not fabricate query results, bypass auth or alter product source. Ordinary sequential behavior remains correct: the sixth request returns 429, and a retry of an existing key returns its original ID without a sixth insert.

Serialize the budget by reporter inside the mutation transaction, or use an equivalent atomic reservation. Keep idempotency retries valid. A request-key lock cannot protect a shared per-reporter budget across different keys.

## P2 · Demo-origin incidents can later publish as real

Source: [incident view hardcodes `false AS synthetic`](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/db/migrations/005-insights-hardening.sql#L4), while [presentation changes according to the current process's demo flag](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/src/insights/routes.ts#L50).

Create three free demo sessions, record fresh synthetic locations, create an SOS for each driver and label each `robo`. The demo app correctly shows `total=3, synthetic=3`. The stored view already says `synthetic=false` for all three events. Reopen that same owned schema without a demo issuer: the public map now returns `total=3, synthetic=0, includesSynthetic=false`. No real verified phone was needed to create these historical rows.

The existing documentation assumes the demo database is dropped after the event. Q43 confirmed its earlier auth review verified that assumption but did not verify persistent aggregation provenance. Preserve synthetic origin durably for incident data, or enforce a fail-closed mode/DB boundary before public reads. Do not rely solely on the current process's demo flag to classify historical records. This probe tests a mode-change boundary; it does not claim that a mixed real/demo deployment is authorised.

## P2 · Attempt-only data is spoken as robbery reports

Source: [fixed advice text](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/src/insights/routes.ts#L20) and [summing `total` for advice](https://github.com/Bimbi-Dev/andes-hackathon/blob/b1c4cb38413cd4f32c801c0bea6f29bdacc0f4c8/src/insights/routes.ts#L90).

Three verified contributors report only `intento_robo`. The public cell correctly has `robo=0, intentoRobo=3, total=3`, but Spanish advice says `3 reportes de robo` and Portuguese advice says `3 relatos de roubo`. The caution level can remain; the wording should preserve attempts or return separate counts. Use wording that covers both kinds, or name their counts explicitly. The original design's fixed example text has the same ambiguity, so this is a semantic correction to the contract/copy as well as the implementation, not an allegation that the code differs from that literal example.

## Verification and retained controls

Node **24.17.0**, pinned lockfile, real owned **PostgreSQL 16.14**, Unix socket only. PostgreSQL 18 was not available locally; these results do not claim PG18 execution.

- Typecheck/build: pass. Final PR80 native suite: **85/85**, exit 0.
- Independent probes: **7 pass, 3 fail**, exit 1. The three failures reproduce the findings above.
- Passed controls: sequential quota/idempotent retry; verified-contributor suppression/advice parity; fixed 90-day hourly lower/upper boundaries; 20-caller/advice single-flight and next-hour refresh; recovery after a real SQL aggregation failure; exact one-hour location freshness, cached relabels and resolved status labels; IANA/UTC acceptance and numeric/unknown-zone rejection.
- Exact PR77 archive: **3/3** focused status-label/demo-source controls pass.
- Candidate source hashes match the reviewed Git blobs. No author source, migrations, prior tests or fixtures were edited. All generated API traffic used injection and local keys; no real notifications, external activation or app server.
- The first reviewer window assertion sorted numeric coordinates lexically; numeric sorting corrected the harness before its final run. The initial native bootstrap failure was a fixture URL issue (host query vs URL hostname), fixed with an encoded Unix host. Neither was a product finding. Initial logs remain outside Git in the raw evidence directory.
- Fixture cleanup left zero test schemas and no extra databases; its owned aux PostgreSQL process was stopped.

[Machine receipt and frozen synthetic outputs](../../review-probes/results/pr80-b1c4cb3/receipt.json), [runnable independent probe](../../review-probes/insights-review.mjs). After building a fresh archive at the exact source with its existing dependencies:

```sh
TEST_DATABASE_URL='<owned-disposable-PostgreSQL-url>' INSIGHTS_TIME_ZONE=America/Lima   node review-probes/insights-review.mjs /path/to/built-b1c4cb3-archive /path/to/new-output
```

Exit 1 is expected until the findings are corrected; inspect the individual JSON facts and assertions. The candidate is read only; the test fixture creates/drops its own unique schemas in the supplied disposable DB.

PR83 must include PR77/80 and these corrections before its integration gate can be reassessed on the actual merged head. Q44 has the exact ancestry and required fixes. Q43's public auth/privacy disposition remains separate, as do human acceptance, evidence gates and live enablement. Nothing was merged or activated.

Refs #29, #40, #76, #77, #80, #83.
