# PR52: complete Robert correction disposition

Historical disposition for `9f87e2c`. Robert's later
[review5560757444](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560757444)
requires further corrections; see [the new finding-by-finding report](robert-5560757444-fixes.md).
The independent acceptance below applies only to its original source revision.

Corrected source: `a5a383f` on `sebasbimbi/test/andes-robert-phone`, preserving
author handoff `4417cf699aee0f25337c23754a1d2561b334bd7f`. Source corrections
for the PR owner to apply are `fd4b0bb` and `a5a383f`. This is a correction
candidate, **not Robert approval or a merge verdict**. The actual PR52 head must
be refreshed before claiming that it contains these corrections.

Read both Robert CHANGES_REQUESTED reviews in full:
[5560453602](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560453602)
and [5560599386](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560599386).
Both reviewed older `b34ca56`; the complete paginated baseline and its current-head
reproductions are preserved at reviewer
[60b59cb](https://github.com/Bimbi-Dev/andes-hackathon/blob/60b59cbb36494d525d0875bd19d29ee2c2b5b0ae/review-probes/pr52-robert-current-head.md).
No review, original probe or failed baseline was dismissed or rewritten.

## Five latest blockers

| Finding | Correction and evidence |
| --- | --- |
| B1: motion budget before throttle | `fd4b0bb`: motion useful-work counting occurs after interval suppression. Independent finite `maxRawCallbacksPerStream` bounds raw callbacks; raw telemetry remains visible. Budget revision becomes `engineering-only/4`. Three new author regressions fail against frozen4417 and pass here; independent complementary 60Hz/cap8 control passes. Raw and useful cap controls stop only motion while useful GPS remains active. |
| B2: transient GPS error flood | Preserved author correction: separate interval throttle and suppression counter; denial remains immediately observable. Unchanged Q52 L08 preserves useful GPS after1000 transient errors. GPS and raw safety caps remain finite and documented. |
| B3: acquisition-blocked event flood | Preserved4417: coalesce diagnostics per stream/reason and count suppressions. Repeated denied/unqualified requests no longer consume every ordinary event slot. Q52 L09 and complementary cap10 control pass with useful GPS alive. |
| B4: precise coordinates survive revoke | Preserved4417: purge buffered/pending coordinates, clear acquisition/wake intents and record revocation even after stop/suspension. Q52 L04/L05/L06 pass. `a5a383f` adds queue composition that stops/purges synchronously before async trip deletion, blocks withdrawn capture/uploads and exposes deletion failure/retry. Already delivered consumer copies and network sends cannot be recalled. |
| B5: synthetic global alias | Preserved4417: explicit detached platform+clock, own injected abstractions, prototype/global and native-object/timer identity checks at construction/acquisition. Unchanged fake-global L07 rejects the alias without sensor work. This is an accidental-use/configuration boundary, not an adversarial JavaScript sandbox. |

## Eleven latest should-fix items

| Finding | Correction and evidence |
| --- | --- |
| S1: finish emits nothing | Reserved `session-stop` slot and nonrecursive delivery preserved; Q52 L01/L02 pass. This proves local terminal notification only. No backend sharing acknowledgement is inferred. |
| S2: code1 always terminal denied | Preserved4417: code1 alone is ambiguous; retain unknown until fresh browser status. Confirmed denied/revoked remains terminal. Epochs reject older passive grants. Complementary dismissal/retry and actual-denial controls both pass. Historical F3 expected denial from code1 alone; independent versioned disposition is pending. |
| S3: permission waiting consumes10s timeout/retries | Preserved4417: separate `permissionPromptTimeoutMs:120000` from post-grant `requestTimeoutMs:10000`; native GPS options retain the latter. One pending prompt stays one request, grants after10s work, and inclusive prompt/session expiry still rejects late answers. Complementary delayed GPS/motion and expired-session controls pass. Bound120s is an explicit finite engineering policy, not a device measurement. [W3C Geolocation §7.2](https://www.w3.org/TR/geolocation/#timeout-member) excludes permission wait from acquisition timeout. |
| S4: geo stream label | Public stop events use `geolocation`; complementary S4 passes. |
| S5: synchronous denial/stop returns ok:true | Settled post-delivery result reflects cancellation/failure; complementary S5 passes. Code1 without confirming browser evidence returns ok:false/permission unknown. |
| S6: unhandled observer fulfilment rejection | Fulfilment/listener faults and rejection are caught, with bounded diagnostic counter. Unchanged Q52 L13 passes. |
| S7: setTimeout throw escapes/strands token | Motion timer failure retires the token, consumes a later permission rejection and returns `timer-unavailable`. Original L11 now observes no throw but still expects generic `platform-error`; preserve that difference for independent versioning. |
| S8: wrong cancellation/clock reasons | Sink stream cancellation returns obsolete-request while session stays active; request clock regression has clock attribution. Both complementary S8 controls pass. |
| S9: sink called during mutations | Event capture queues detached events and flushes at settled transitions. Explicit request/permission phase barriers preserve cancellation before native acquisition. Synchronous native callback and nonrecursive terminal controls pass. |
| S10: event serialized three times | One retained capture plus one detached delivery copy replace the separate permission/event/delivery copies. Snapshot isolation and pending-coordinate purge remain tested. No synthetic throughput result is a battery measurement. |
| S11: local paths prevent reproduction | Author verification and both historical disposition documents now use PATH-based Node and disposable archive variables. Exact old reviewer files are published byte-identically under `review-probes/historical/cc4dc5d2/`; commands below require no personal path. |

## Earlier review and motion/upload utility

| Earlier finding | Current disposition |
| --- | --- |
| R1: short trip budget/silent stop | Local terminal event and24h default/seven-day maximum remain. Ten-hour foreground author simulation is software evidence only. Kill/shutdown can prevent local event execution. |
| R2: activation/resume/wake lock | Explicit visible-page resume, synchronous trusted legacy-event bridge and best-effort screen wake lock remain; late/stopped/deadline and valid-consent resume controls pass. Suspended withdrawal now blocks resume. UI binding and physical lock/background capture need their own evidence. |
| R3: accuracy hint | High accuracy true by default; per-request override and actual reported accuracy/source uncertainty remain distinct. |
| R4: qualification/context/consent complexity | Trip factory binds one selected reviewed packet and exact trip consent. It cannot invent a physical packet; unqualified device mode stays blocked. |
| R5: browser-managed motion | Explicit gated path remains available as opt-in evidence tooling, with unknown permission when no express-permission API exists. Active-trip factory acquires GPS only. No Android qualification is claimed. |
| R6: error flood | Preserved error throttle and successful-fix control, as B2 above. |

Internal product disposition: **GPS-only active-trip sharing**, with raw motion
retained outside that path for explicit, qualification-gated #19/#9 confounder
and resource evidence. No rule consumes motion or establishes a crash, assault
or sleep. PLAN#19 permits retiring a motion rule without observable benefit;
this candidate does not add such a rule. This reasoned scope still requires
Robert's confirmation of his remove-motion recommendation.

`createQueuedTripPhoneObservations` composes the actual Q42 pipeline interface;
it delegates sink, persistence handoff, upload and trip status and adds no HTTP
implementation or route. Four host-boundary tests cover GPS-only capture,
delegate calls, synchronous purge before async deletion, deletion failure/retry,
blocked revoked start/resume/flush and explicit status failure.

**Integration HOLD:** Q47 has not cleared queue9b53b74: a new POST can still
start after retirement across the final store await; unresolved intent is not
durable across restart, and sign-out/receipt findings remain. Queue owner42
owns those corrections. Do not claim a real adapter→reviewed queue→backend
upload until the corrected queue passes independent review and the coordinated
actual-backend proof runs. Q44 owns integration; Q46 supplies the owned
PostgreSQL/signed-HTTP fixture pinned to backend5591c9b. Robert PR74 publishes
additional sharing/status routes under separate review; they are not adopted
or invented by this candidate. The core pinned backend's `/locations` route
is the only current location transport target for that planned proof.

## Actual results and unchanged historical differences

Node **24.17.0**; no installs, real sensor, participant/provider/notification,
shared database, environment mutation, service, deployment or author merge.

| Check against sourcea5a383f | Actual result |
| --- | --- |
| Author adapter + unchanged recorder | 102/102 pass (71 adapter +31 recorder) |
| Q57 complementary follow-up | 12/12 pass; baseline4aca was2/12 |
| Three B1 author regressions against frozen4417 | 0/3 pass; corrected source3/3 |
| Original22 reviewer suite, byte-identical | 17/22: P03/F4 old low-accuracy defaults; P06 old browser-managed-motion exclusion; P15 old combined prompt/acquisition timeout; F3 code1 alone treated as confirmed denial |
| Original four-case reproducer | F1/F2 pass; F3 permission semantics and F4 accuracy expectation differ |
| Explicit Q52 contract-v2 from534dba0 | 20/22: P15/F3 differences above |
| Unchanged Q52 lifecycle16 from534dba0 | 14/16: L11 specific timer reason and L12 permission unknown differences above |

The untouched historical suites are deliberately still red; these are not
silently relabeled passing tests. Q52 owns independent evaluation and any
separately versioned expectations, including positive confirmed-denial,
stale-query, useful-grant and delayed-deadline controls. This author/correction
evidence cannot substitute for that independent verdict.

The original SHA-256 values remain:
`probes.test.mjs`: `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756`;
`reproduce.mjs`: `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85`.

Portable commands from a fetched reviewer checkout, Node24.17.0 on PATH:

```sh
author_dir=$(mktemp -d)
prior_reviewer_dir=$(mktemp -d)
git archive a5a383f | tar -x -C "$author_dir"
git archive 534dba01b2d53bfd970c858be8f2cc53458439dd review-probes | tar -x -C "$prior_reviewer_dir"
node --test "$author_dir/tests/phone-observations/adapter.test.mjs" "$author_dir/tests/phone-capability/recorder.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node --test review-probes/robert-pr52-followup.test.mjs
ANDES_CANDIDATE_DIR="$author_dir" node --test review-probes/historical/cc4dc5d2/probes.test.mjs
ANDES_CANDIDATE_DIR="$author_dir" node review-probes/historical/cc4dc5d2/reproduce.mjs
ANDES_CANDIDATE_DIR="$author_dir" node --test "$prior_reviewer_dir/review-probes/phone-contract-v2.test.mjs"
ANDES_CANDIDATE_DIR="$author_dir" node "$prior_reviewer_dir/review-probes/phone-4aca76c-lifecycle.mjs"
```

Expected exits:0,0,1,1,1,1. The lifecycle script hardcodes4aca in its printed
candidate field; its `ANDES_CANDIDATE_DIR` above selects exact sourcea5a383f.
Use the command's archive SHA, not that historical display label, as provenance.

Before requesting Robert's final confirmation: obtain Q52 exact-head check,
coordinate the source commits into existing PR52, refresh all feedback surfaces
and actual head, publish per-item replies and request re-review. Queue/backend
integration and Robert's scope confirmation remain separate unresolved gates.
No review dismissal, author merge or product issue closure is authorized.
Physical iPhone lock/background, device qualification, matched battery/data,
real-browser durable storage, delivery and human outcomes remain unproven.
