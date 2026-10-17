# Independent phone adapter review

**FIX** exact author `4aca76c34a5c1639dccad9cff6a01f00f7023ac2`, PR52.
Base `bc8eeabfe5220e66a83be972b480a1d1ae8d87d2`; reviewer52 changed no author files.
All57 files in the fresh Git archive were independently hashed against that tree.
The recorder, old published branches and original reviewer evidence remain unchanged.

Read every paginated live PR issue comment (2), formal review (4), inline comment
(0) and review thread (0). Both Robert CHANGES_REQUESTED reviews are actionable:
[5560453602](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560453602)
and the later
[5560599386](https://github.com/Bimbi-Dev/andes-hackathon/pull/52#pullrequestreview-5560599386).
The six-item author reply addresses the first review, not the full second review.
COMMENTED findings count. Original human confirmation is still required.

## Reproduced findings

1. **P1: withdrawn consent can resume precise acquisition.**
   `adapter.mjs:544–551` returns before revoking an inactive session, while
   `trip-sharing.mjs:35–37` clears the factory consent but resumes the adapter
   without checking it. Start with trip consent, emit a precise fix, hide the
   page, revoke while suspended, show it and explicitly resume. Actual L04:
   `{ok:true,calls:2,newPrecise:1}`; expected no resumed acquisition. The paired
   valid-consent resume L03 passes and obsolete callbacks stay inert. Revoke
   must invalidate stored intents/consent even after automatic stop, and every
   resume path must recheck current trip consent.
2. **P1: withdrawal retains adapter-owned precise coordinates.** Robert's second
   review blocker4 still reproduces in L05/L06. Both active withdrawal and
   withdrawal after stop leave one precise event in `snapshot().events`.
   Purge retained sensitive values and stale consent/intents across active and
   stopped states. A consumer-owned old copy is outside the adapter's control;
   these cases inspect its own buffer.
3. **P2: inherited global alias bypasses synthetic isolation.** Robert blocker5
   remains at `adapter.mjs:29`. L07 installs only inert fake browser functions
   in the Node process, passes `Object.create(globalThis)` and omits the clock.
   Actual: accepted with one fake native GPS call. Expected no hardware path
   enabled by a synthetic fixture. No real device API was touched. Require an
   explicit isolated synthetic capability/clock boundary, or otherwise reject
   global aliases instead of relying on direct object identity alone.
4. **P2: blocked diagnostics still consume the shared ordinary event cap.**
   `adapter.mjs:225`, Robert blocker3. L09 uses the valid configured cap10,
   starts useful GPS and repeatedly requests unqualified motion. The blocked
   diagnostics stop the GPS watch. The higher new default moves the exhaustion
   threshold; this is not a claim that the old300-call default reproduction is
   unchanged. Rate-limit/coalesce rejected diagnostics or obtain an explicit
   human disposition for the retained behavior.
5. **P2: platform faults escape their attribution boundary.** L11 reproduces a
   synchronous timer throw at `adapter.mjs:409`, leaving the motion token until
   cleanup; L13 observes one unhandled rejection when a permission monitor's
   fulfilment path throws at `:185–200`. Both are explicit should-fix items in
   Robert's second review. Return a bounded attributed failure, retire tokens,
   and handle errors from promise fulfilment as well as promise rejection.
6. **P2: synchronous GPS denial reports success.** L12 uses an inert native spy
   that synchronously invokes code1. `adapter.mjs:370` returns `ok:true` while
   permission is denied and acquisition has already retired. Recheck the
   outcome/token before returning success. This also confirms Robert's item.

## Actual results and contract changes

Node22.22.3, no installs, real sensors, servers, database or providers:

```sh
# From a disposable exact author archive:
node --test tests/phone-observations/adapter.test.mjs tests/phone-capability/recorder.test.mjs
ANDES_CANDIDATE_DIR=/absolute/author-archive node --test /absolute/reviewer/review-probes/phone-contract-v2.test.mjs
ANDES_CANDIDATE_DIR=/absolute/author-archive node /absolute/reviewer/review-probes/phone-4aca76c-lifecycle.mjs
```

Author tests: **82/82 pass**. Original immutable independent suite: **19/22**;
original minimal reproduction: **F1–F3 pass**, F4 differs only on high accuracy.
Original hashes: probes `0da135e3c2aa6dc9364d955b948e35e6d75fa57f8d36aa14b5a567e92321f756`;
reproducer `abc8294f928c03f838d03016df051634d47b8f20c73a416dbd87954504db5a85`.

The separately versioned `phone-contract-v2.test.mjs` changes only the two
high-accuracy default expectations to true and the absent-requestPermission
control to explicitly acquired browser-managed motion with permission unknown.
Those are Robert R3/R5's requested semantics. It retains the original identity,
source-time, error provenance, denial, resource, reentrancy, redaction and
confounder checks: **22/22 pass**. This is an explicit contract update, not an
unchanged22 pass or qualification of any physical device.

New independent lifecycle/privacy/fault controls: **8 pass /8 fail**, exit1;
full actual/expected output is `phone-4aca76c-results.json`. Positive controls
pass for the reserved terminal slot, one deferred terminal delivery after a
reentrant sink stop, valid-consent resume and stale callbacks,1000 transient
GPS errors with999 suppressed then a useful fix,1800 motion callbacks over30
simulated seconds, late/inclusive-deadline wake-lock release, and synchronous
legacy gesture scope. These establish logic behavior only.

The initial L16 fixture let a passive permission query grant before an async
continuation, correctly allowing reacquisition under the new known-grant rule.
The final control keeps that query pending to test unknown-permission gesture
scope. Its expected assertion was retained; the initial local output is kept
as fixture history and is not counted as an adapter finding.

## Complete human-feedback disposition

| Live feedback | Exact-head observation / remaining gate |
| --- | --- |
| Prior reviewer52 F1–F4 | Cancellation/deadline/terminal permission/options behavior remains correct under the explicitly versioned R3/R5 expectations; earlier artifacts preserved |
| First Robert R1 terminal emission/long trip | Local terminal slot and reentrant stop pass. Default24h and larger finite caps replace old five-minute/256 limits. Author ten-hour foreground simulation passes within82 tests; no background or server receipt proven |
| R2 activation/resume/wake lock | Positive synchronous legacy/resume/wake controls pass; consent-after-suspension finding above blocks acceptance; actual Reanudar UI binding remains pending |
| R3 high accuracy | True default and preserved measured-source uncertainty pass; explicit override author check passes |
| R4 integration/qualification setup | Factory provides exact trip-bound setup but still requires an actual reviewed context; physical packet remains not-run and cannot be fabricated |
| R5 browser-managed motion | Explicit path works while permission remains unknown; human's later remove-motion recommendation needs a response/scope disposition |
| R6 / second blocker2 GPS errors | Separate error throttle passes1000-call positive control and useful fix; raw callback limit remains finite |
| Second blocker1 motion callback budget | New default survives30 simulated seconds at60Hz; raw callbacks are still counted before emission throttle. Bounded guard versus requested long-trip behavior needs explicit author/human disposition |
| Second blocker3 blocked-acquisition budget | Still counts against ordinary cap; L09 demonstrates active GPS teardown under configured cap10 |
| Second blocker4 precise buffer | Unresolved, L05/L06; new L04 exposes revocation/resume consequence |
| Second blocker5 synthetic global alias | Unresolved, L07 |
| Second should-fix terminal event | Local emission now passes; server sharing route/acknowledgement remains outside this candidate |
| Code1 prompt dismissal | Still maps code1 to terminal denied; no new answer distinguishes dismissal from a persisted denial |
| Permission prompt/local timeout/request budget |10s local timeout still begins before permission resolves; explicit author response and human disposition pending |
| GPS stop stream name | Callback-budget stop still uses internal `geo`, versus ordinary `geolocation` |
| Synchronous denial return | Unresolved, L12 |
| Permission monitor fulfilment throw | Unresolved, L13 |
| Motion timer throw | Unresolved, L11 |
| Cancellation/backwards-clock reason codes | Generic session-stopped/obsolete-request branches remain; needs explicit disposition rather than dismissing the feedback |
| Queue ordinary sink events after settled state | Terminal stop delivery now defers; ordinary events still call the synchronous sink during transitions. Prior F1/F2 controls pass, but the architectural recommendation requires an answer |
| Repeated JSON serialization | Still copies permission, retained event and sink payload; requested performance disposition pending |
| Portable verification commands | Existing author verification docs still name personal local paths; new reviewer commands above are parameterized |
| Utility: upload sink and remove motion recommendation | No HTTP/upload sink in this head; separate queue/client/backend/UI ownership and scope need an explicit response agreed with Robert. The cited future sharing route is not invented by this review |

No unresolved human finding is overridden by the passing controls. Publish a
corrected immutable head with regression evidence and responses to both reviews;
request reviewer52 confirmation for these findings and Robert confirmation for
his requests. No merge permission, issue closure, real-stream default enablement,
device qualification, locked-screen capture, delivery, battery/data or human
benefit claim follows from this review.
