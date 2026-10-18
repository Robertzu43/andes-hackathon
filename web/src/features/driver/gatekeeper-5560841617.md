# PR63 gatekeeper5560841617 disposition

Original: https://github.com/Bimbi-Dev/andes-hackathon/pull/63#pullrequestreview-5560841617
Reviewed baseline:80e9d45f9a234de54b1017e856e8349c097b8760.
Normal base merge:dfa308b3b745a3342891ebcc0771f32a30862d5a; no protected push.
Full formal reviews, issue comments and inline comments were read. At capture,
there are no inline comments; the9 required findings are in the formal review.
The unmodified review JSON is preserved alongside synthetic red/green receipts.

| Finding | Repair and evidence |
| --- | --- |
| R1 SOS interaction gate | SOS and its explicit retry use authentication/network gating independently of motion. Unchanged reviewer unknown/moving controls fail before/pass after; ordinary moving command still blocks. |
| R2 cached incident | Every explicit nonpending SOS sends; actual database test resolves the old incident outside the controller, presses again with stale cached active state and obtains a second incident. One incident remains active. |
| R3 unknown/clock lockout | Explicit SOS press retries original uncertain body/key. Pending presses still coalesce. Received acknowledgements survive forward/backward wall-clock correction; actual timeout retirement still ignores late replies. |
| R4 second OK | Sequential OK/rest create distinct intents/keys. Signed persisted journey records two OK events. |
| R5 credential refresh | Same verified actor retains pending/unknown SOS and bound trip. Changed actor/signout still clears private state. SDK45 owns issuer/subject continuity and real refresh binding; its corrected exact-head integration remains required. |
| R6 locale | Draft and confirm send canonical es-PE/pt-BR. Native regression fails on baseline and passes after. |
| R7 failed open | No trip binding before authorized successful read. Initial403/404 leaves no trip; foreign signed API read cannot authorize SOS. |
| R8 uncertain confirm | Same-draft owner read reconciles a committed trip. Same-key rejection checked after successful idempotency replay can prove no commit for three narrow domain codes. Lost committed and lost rejected responses are both covered by real SQL/API tests. Generic403 remains unknown. |
| R9 status/arrival | Additive readStatus/refreshStatus and optional expectedArrivalAt follow published74/27e4f94, with native red/green and actual signed API/PostgreSQL status tests on published74/27e4f94. Open checks, repeated OK, sweeper incidents and persisted optional arrival pass. SDK81 owns the production HTTP binding; do not claim live support on dfa308b. |
| S1 old active activation | Arrival/cancel clears the active activation view; original confirmation remains in operations.confirm. Other commands invalidate it, and a closed owner read also clears it. Two native regressions are preserved red at127c82a and green after. |
| S2 truck duplicate | Pending identical registration coalesces; completed identical label reuses receipt. Native baseline red/green. |
| S3 duplicate decoders | Injected decodeResponse uses the shared SDK wire decoder and only semantic owner/request correlations afterward. No duplicate wire validation executes when bound. Native red/green proves invocation, exception handling and foreign-owner rejection. SDK45 owns the shared export and production binding; exact composition evidence is a separate dependency. Native fallback remains for non-SDK synthetic consumers. |
| S4 notification cost | One detached recursively frozen snapshot per notification; all subscribers share it and cannot mutate later views. |

Unchanged independent11-case source SHA256:
3f9e30471f6f6baef338f9ae362624dfc4f9f07f1ae73dfd643ec6b56b29e570.
No reviewer source was edited. Historical tests asserting cached SOS/no-send,
wall-clock rejection and permanent domain-rejection unknown were contrary to
this current gatekeeper oracle; their old source remains in80e9d45. The author
suite was updated to the requested behavior with preserved before output.

The historical7-case reviewer oracle is not relabelled current acceptance.
Its owner has changed checkouts; the first attempted old filesystem path was
absent, so that invocation did not run. Independent47's current11 controls ran
unchanged and passed. Other-side confirmation, new CI and required SDK/runtime
integration are still open; this document does not approve the author's PR.


Follow-up validation:45 native checks + strict TypeScript + unchanged11 reviewer
controls +6 signed base-backend journeys +1 signed published-status-backend
journey pass. Before this follow-up,42/44 native checks pass with the decoder
and closure controls red at127c82a. The added canonical-arrival control also
fails before normalization and passes afterward. Published-status test is0/1
at80e9d45 and1/1 after; all original raw failures remain preserved.

The first repair127c82a passed both GitHub backend checks39086978588 and
39086980672. A later source change needs fresh CI; no prior green is reused
for a changed head. The controller status test uses only a test-owned mapper
into the actual published API, keeping production HTTP/SDK ownership with45.
