# Independent app acceptance evidence

This lane52 harness checks redacted receipts from lane46's isolated backend runs.
It performs no HTTP requests, starts no service, creates no database and never
calls a device or provider. It supplements the backend's integration tests and
independent browser review; it does not implement another backend or certify a
whole app. Refs #24, #35, #38; their human/physical prerequisites remain open.

Both CLI entrypoints compare physical file paths, so macOS `/var`/`/private/var`
aliases and symlinked worktree paths execute normally. Consumers must require
nonempty parseable JSON as well as the exit status. Two alias regressions failed
before this correction; the existing canonical CLI and receipt controls remain.
Snapshot aging requires matching nonempty trip aliases, and both repeated SOS
responses must remain active with unavailable group capability. Three additional
reviewer counterexamples failed before these predicate repairs.

Current reference: `main` backend `02f3647462a4db57ae1ce81f1023fc83d3d06a46`.
`BACKEND_SHA` in `oracle.mjs` is the only copy; the receipt producer in
`scripts/app-integration/receipts.mjs` imports it. Earlier bindings
`5591c9b55fe7f4505e36ccee96d27aa913e0debf` and
`ebc8fb1d36f441ef012ca585201cefabf61383d6` are historical; their receipts are
rejected by this checker and must never be relabelled. Read
`docs/contracts/runtime.md`, `package.json`, `docs/evidence/backend-progress.md`,
`src/api/app.ts`, `src/trips/routes.ts`, `src/contacts/routes.ts`,
`src/location/routes.ts`, `src/incidents/routes.ts`, and existing test helpers.
The freshness value of 120 seconds is that implementation's engineering bound,
not an accepted safety cadence. A new backend SHA requires source review and
explicit rebinding; changing a receipt's revision is not sufficient.
See [rebindings.md](rebindings.md) for the exact reviewed source delta, original
predicate-repair proof and fresh-producer requirements. This PR changes the
checker only; root backend integration stays with44.

Run with the backend's supported Node 24–26, no dependency install:

```sh
node --test evidence/app-acceptance/oracle.test.mjs
node evidence/app-acceptance/synthetic.mjs > /tmp/andes-synthetic-receipt.json
node evidence/app-acceptance/check.mjs /tmp/andes-synthetic-receipt.json
```

The last command intentionally exits **2**, `inconclusive`: all twelve synthetic
case controls pass, but synthetic fixtures are not observations of a running app.
An invalid receipt or failed assertion exits **1**. A complete isolated-backend
receipt whose assertions pass exits **0**, `backend-receipt-checks-pass`; that
still does not accept a browser, provider, physical phone or human outcome.
`wholeAppAccepted` is always false. Whole-app acceptance remains an independent
review disposition after the versioned UI proof and actual interactions pass.

## Receipt seam for lane46

Produce JSON with `schema: 'andes.app-acceptance.receipt/1'`,
`kind: 'isolated-backend-run'`, the exact `backendSha`, `externalSends: false`,
`isolatedDatabase: true`, an opaque `producer`, the exact execution `command`,
and a `cases` array. Use the exported synthetic fixture solely as a labelled
format example. Do not relabel it as a measured run.

Each case contains its fixed `id` and ordered `steps`. Each HTTP step records
`method`, normalized registered `route` pattern, `actor` role
(`driver`, `contact`, `stranger`), selected redacted `request` fields,
integer HTTP `status`, and selected `response` fields. Idempotent replay also
records an opaque `keyAlias`. Preserve the relationships between opaque IDs;
aliases must not merge different trips/incidents/grants. Normalize the route
from the actual request/registered route, never from its expected result.

This is an evidence interchange format, not a new server API. Lane46 owns the
real PostgreSQL/signed-auth execution and its raw private records. Keep receipts,
DB names/URLs, auth keys, JWTs, headers, phones, coordinates and real participant
records out of Git/PRs. The selected receipt fields need no coordinates, raw trip
text or phone values. The parser prints case IDs and static errors, never raw
payloads. Files are bounded to 512 KiB, twelve cases and forty steps per case.

No receipt parser can prove who produced JSON or that HTTP actually happened.
An independent reviewer must bind it to the immutable source and inspect the
producer's raw command/log/test evidence. A caller-set evidence label is never
proof of runtime execution or authorization. The test simulating that label
only checks the output category; it establishes no backend run.

Each case is a separate controlled scenario. Source paths and required exchanges
are in `oracle.mjs`. Missing cases remain pending. The suite's adverse controls
must turn red for invented delivery, widened scope, implicit confirmation,
receipt-time freshness, retained revoked access, acknowledgement-as-action,
arrival-as-resolution, cross-user access and automatic policy from self-report.

## Browser handoff and current result

See [matrix.md](matrix.md) for the actual API bindings, required UI states,
Spanish/pt-BR and mobile checks. App route patterns are now bound to Brain's
validated `andes-operate-v1` packet, with its exact hashes in the matrix.
The actual production-preview origin and rendered state inventory are pending49.
No UI screenshot, contrast measurement,
keyboard interaction, production build or signed database journey has been
performed by the receipt checker. A separate unchanged lane46 runtime was
independently executed at `b5d96a5eb4ae39babf5b91318c5c65a08ac1c66f`: typecheck,
build and61 tests passed on Node24.17.0/PostgreSQL16.14 with an owned database
and port56452; [scoped published evidence](https://github.com/Bimbi-Dev/andes-hackathon/pull/58#pullrequestreview-5560497484).
This does not supply normalized receipts or browser evidence, nor cover that
runner's later CI-service entry point. Those dependent checks remain pending.

Lane46 owns real API integration/DB isolation. Lane49 owns the shared frontend
foundation and Design Contract; lanes50/51 own driver/contact screens. Lane52
consumes their immutable candidates and raw evidence independently. Actual
browser checks require a lane-owned isolated production build, its Git
fingerprint, current route inventory, no live sends and controlled identities.
Use the Codus browser and the shared UI Evidence Manifest, preserving failing
captures and validating a disposable missing-evidence control.

Skill reads: code-review, create-branch, commit, pr-writer, codus-testing,
codus-ui-proof, codus-site-seo, codus-brand-identity and codus-brand-furniture.
The app is an operational utility surface. Metadata/branding are reviewed from
the foundation; no keyword campaign or invented public business proof is needed.
No deployment, issue closure, self-merge, physical qualification, provider delivery
or reduction in fatigue/robbery is authorized by this software receipt checker.
