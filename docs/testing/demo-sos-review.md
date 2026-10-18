# Functional demo SOS review controls

These independent controls reproduce the original counterexamples in gatekeeper
reviews [59/5560836622](https://github.com/Bimbi-Dev/andes-hackathon/pull/59#pullrequestreview-5560836622)
and [63/5560841617](https://github.com/Bimbi-Dev/andes-hackathon/pull/63#pullrequestreview-5560841617).
They live on the review-artifacts branch, not in the product or its CI gates.

Verified Git archives were used for client
`7e241c39a31d4eaba5f8028fd977e06f6ca72d4d` and driver
`80e9d45f9a234de54b1017e856e8349c097b8760`. The supplied root/SHA association is
manually checked by the reviewer; the scripts do not attest directory provenance.
Both scripts ran with Node26.3.0 and synthetic in-process transport only. No
backend, browser, physical iPhone or provider behavior is qualified.

```sh
ANDES_REVIEW_API_ROOT=/ABS/VERIFIED/API/ARCHIVE \
ANDES_REVIEW_DRIVER_ROOT=/ABS/VERIFIED/DRIVER/ARCHIVE \
  node tests/client-contract-review/api-sos-safety.probes.mjs
ANDES_REVIEW_DRIVER_ROOT=/ABS/VERIFIED/DRIVER/ARCHIVE \
  node tests/client-contract-review/driver-sos-safety.probes.mjs
```

Each baseline has **3 passed / 8 failed**, with expected exit1. The positive
controls pass, and the failures preserve observed call counts and state without
publishing tokens, raw identities or HTTP bodies. Probe hashes and exact source
pins are recorded in `client-contract-reviews/*-sos-safety.json`. Preserve these
assertions when an owner publishes a corrected head; do not move old results to
that head or report technical acceptance of unrelated findings.

The client cases bind the actual frozen driver through the actual client facade.
They cover accepted/pending200 SOS during same-identity refresh, four zero-fetch
failures,429 classification, missing `AbortSignal.any` and timer cleanup. Real
post-dispatch loss/abort remains unknown without retries.

The driver cases cover moving/default-unknown SOS availability, stale incident
cache, a new SOS press after uncertainty, wall-clock changes, repeated explicit OK
and same-actor continuity. Controls preserve coalescing of a pending SOS, ordinary
interaction gating and cleanup for a different actor.

Historical raw failures remain at their original commits. The earlier full
client/backend bridge receipt is private; its public summary records provenance,
case/status counts and the original receipt digest without raw data. The summary
is neither a new run nor the interchange receipt previously checked by lane52.
