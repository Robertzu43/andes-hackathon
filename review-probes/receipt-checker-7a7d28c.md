# Independent predicate correction and backend rebind review

Final checker: `7a7d28cbd711cfd6a1a86ec6d8a94ab6e044d366`, PR60.
Intermediate predicate correction: `a9e3d404d029062bbe159cca11f69020b12fb072`.
Verdict: **ACCEPT for the corrected checker and explicit backend binding**.
Both original Q48 findings are resolved. Actual new runtime receipts and
whole-app/browser acceptance remain separate evidence.

## Original failure and unchanged intermediate proof

The [original FIX report](receipt-checker-e3ed972.md), frozen probe and results
at `7a15e85cd8d49893718561d1994f829d1c1a07cf` remain untouched. Three incorrect
acceptances originally demonstrated two predicate gaps.

The intermediate correction requires nonempty matching snapshot trip aliases
and applies active/unavailable invariants to both SOS responses. Only the
three-file predicate/docs/test delta changed; the backend pin remained EBC.
In a fresh archive, **33/33 author tests and the original byte-identical
20/20 reviewer controls pass**, exit 0. Thus both findings were independently
resolved before changing any revision expectation.

## Explicitly versioned rebind driver

The original control intentionally rejects `5591c9b` under the old EBC binding.
That input becomes valid after an authorized rebind; calling its resulting
19/20 score a pass would hide an assertion failure. The original file is never
edited or skipped.

`receipt-checker-rebind.mjs` checksum-locks the original probe to SHA-256
`d3714238dbf65668f739f6da0b63dc40b1ad284215fa69ffb90e7f1c38670d9b`.
It requires candidate backend `5591c9b`, then binds exactly one datum in a private
temporary copy: the foreign-revision input becomes old EBC. Every predicate and
expected result stays unchanged. The temporary file is removed; candidate source
and the frozen probe are never edited.

Three additional controls explicitly check:

- Reviewed `5591c9b` is recognized only as backend evidence.
- Old `ebc8fb1` is rejected.
- An unrelated all-zero revision is rejected.

Every output must retain `wholeAppAccepted:false`. Success requires a parsed
20-control summary, zero unexpected outcomes and all three pin checks. The
driver was itself tested against a controlled instrument fixture with one
predicate defect restored: **19/20 is rejected, exit 1**. It also rejects an
old-pin candidate before attempting to reuse the new binding. These disposable
fixtures validate the reviewer instrument; they are not observed runtime runs.

Run from the reviewer checkout with a writable archive of the exact candidate:

```sh
node review-probes/receipt-checker-rebind.mjs /ABS/FROZEN_CHECKER_ARCHIVE
```

Both this driver and the original `receipt-checker-probes.mjs` must be present
beside one another. No package install, HTTP, database or provider is used.

## Final candidate evidence and source review

Node 24.17.0, fresh final archive: **34/34 author tests pass**; the driver reports
**20/20 predicate controls plus 3/3 explicit revision checks**, exit 0.

Read the complete intermediate-to-final delta: the oracle changes only its
backend constant, adds old-source rejection coverage and documents the binding.
The route matrix's twelve rows and original contract/map hashes are preserved;
its header now identifies the reviewed backend. The source delta from EBC to
`5591c9b` was already independently reviewed in PR61 and checked again here:
API registration, auth, trip/contact/location/incident routes, DB source and
migrations are unchanged. Dispatch gains the reviewed post-quota expiry refresh;
package/CI/tooling changes add no HTTP route or consent capability.

The README and rebindings document correctly reject relabelled old receipts,
require fresh producer source-guard evidence and keep the unrelated PR58 producer
guard finding separate. This review accepts checker behavior, not a claim that
a new runtime receipt has already been produced or that PR58's guard is fixed.
No Q48 checker finding remains on the reviewed final head.

[Intermediate output](results/a9e3d4/unchanged-independent.txt),
[driver sensitivity receipt](results/a9e3d4/driver-rejects-19-of-20-instrument-fixture-driver.json),
[final author tests](results/7a7d28c/author.txt), and
[final driver result](results/7a7d28c/rebind-results.json) are preserved.
All controls are explicitly simulated checker inputs; no private actual runtime
receipt is committed, relabelled or duplicated.

The original reporter's entrypoint confirmation remains valid. Required fixes,
answers and reviewer confirmations for genuine findings elsewhere remain in
force. Integrator44 retains the final head/feedback/check/inbox audit. No blanket
human-confirmation condition, merge, deployment or issue closure is added here.
