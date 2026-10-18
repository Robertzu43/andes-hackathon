# Reviewed backend binding and predicate repair

Current oracle target: `5591c9b55fe7f4505e36ccee96d27aa913e0debf`.
Historical target: `ebc8fb1d36f441ef012ca585201cefabf61383d6`.
The prior published checker/receipts remain frozen evidence. New receipts must
come from a fresh run of the actual current runtime under the producer's source
guard. Changing an old receipt's revision label does not produce evidence.

The user/Brain explicitly requested this coordinated binding with46 and44.
Lane52 reviewed the complete protected-source diff (`src`, `db`, manifests and
compiler config), runtime-contract delta and six new dispatch-expiry tests.

| Source area | Observed delta | Effect on the twelve receipt cases |
| --- | --- | --- |
| API registration, trip/contact/location/incident routes, auth and response contracts | Byte-unchanged from ebc | Same route patterns, roles, payloads, source/receipt/read fields and active/unavailable/ack/action semantics |
| Database source and migrations, package-lock, TypeScript config | Byte-unchanged | No new schema or dependency/clock encoding inferred |
| `src/notifications/dispatch.ts` | After acquiring the account quota lock, refresh `now`; recheck lease and job expiry; use refreshed time for authorization/quota records | Removes authorization after expiry while waiting; equality is expired. It does not add a delivered fact or change the SOS HTTP response |
| `tests/dispatch-expiry.test.mjs` | Six actual-SQL wait controls: just inside/equal/after job and claim lifetimes | New runtime tests belong44/46; predicate-only checks do not replace them |
| package/CI/tooling and merged preparatory evidence | Adds `test:tooling`, `test:all`, shared tooling runner and source/evidence artifacts | No application route or permission capability created by tooling |

This source review permits the checker to recognize559 receipts. It is not a
claim that52 already ran a new559 database journey, that all frontend routes are
implemented, or that provider/physical/human gates passed.46 owns fresh runtime
capture;52 independently evaluates the immutable handoff and keeps unavailable
evidence explicit. The old source must reject in the new checker, and the old
checker must continue rejecting559. No automatic dual-source fallback exists.

## Q48 findings

The [independent FIX comment](https://github.com/Bimbi-Dev/andes-hackathon/pull/60#issuecomment-6243019653)
found missing trip aliases comparing as `undefined === undefined`, and state/
group-capability checks missing on the second SOS response. Three counterexamples
were independently reproduced before repair. `a9e3d404d029062bbe159cca11f69020b12fb072`
requires matching nonempty trip aliases and active/unavailable on both responses.
The equal-valid-ID and duplicate-episode positive controls remain intact.

The original reviewer probe at `7a15e85cd8d49893718561d1994f829d1c1a07cf`
is preserved unchanged. It targets the ebc binding and contains a specifically
hard-coded negative `backendSha=559`; run it against the immutable a9 predicate
slice for that original expectation. After this authorized rebind,559 is valid,
so that one source-rejection control needs a separate reviewer-owned update to
reject old ebc/another unreviewed source. Do not edit or weaken the original probe,
silently skip its source control or call a changed expectation an unchanged pass.
All its response-identity/state and fail-closed expectations remain applicable.
Lane52 extracted that exact probe blob `256b3ca7ece155766de28aab7520dade8994ffda`
beside an immutable a9 archive and independently observed **20/20 expected**,
exit0. The original e3 review's 17/20 failure record remains preserved.

The earlier path-alias finding was separately fixed at e3ed972 and confirmed by
its original reporter in [review5560533890](https://github.com/Bimbi-Dev/andes-hackathon/pull/60#pullrequestreview-5560533890).
Current entrypoints still require real physical file identity and nonempty JSON
under canonical/noncanonical/symlink invocation. `wholeAppAccepted` stays false.

## Producer provenance gap remains a separate fix

Lane52's [PR58 FIX at737](https://github.com/Bimbi-Dev/andes-hackathon/pull/58#pullrequestreview-5560549475)
shows that an ignored runnable SQL migration bypasses `--exclude-standard` in
the source guard. A revised producer must inventory ignored protected runtime
files too and retain the failed probe/clean positive control. Do not interpret
this oracle rebind as confirming that the producer guard was repaired. All
actionable feedback still requires fix/test evidence and reviewer confirmation.
