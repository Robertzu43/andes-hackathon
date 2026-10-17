# Independent client contract oracle

Reviewer lane 47 owns `tests/client-contract-review/`. The source contract is
Robert's `codex/aws-durable-backend` at
`ebc8fb1d36f441ef012ca585201cefabf61383d6`, specifically
[`docs/contracts/runtime.md`](../contracts/runtime.md). Phone boundary PR52 is
`b34ca56a79515104d7412d46f0e20d7045a5ba8e`; monitoring boundary PR53 is
`e9df5cbfd5c2cfbb19698d46bb957b8561920e66`. Record replacement SHAs before adapting
these tests. Fixtures are fabricated and contain no production identities or evidence.

Run with a backend-supported Node 24–26 (exercised with Node 26.3.0):

```sh
node --test tests/client-contract-review/*.test.mjs
```

No package install, server, database, provider or browser is required for this
fixture/transport self-check. The injected fetch accepts only the reserved
`https://andes.synthetic.invalid` origin and never forwards a request. It can
return exact contract bodies, HTTP errors, malformed JSON, a lost response, or a
held response that deliberately ignores cancellation. The latter tests session
generation checks rather than assuming abort prevents a late server response.
Unscripted retries, unexpected routes/methods and wrong bodies fail the transport.
The clone-isolated memory store persists across a test driver's recreation;
it is not a substitute for real IndexedDB reload, quota or browser proof.

## Acceptance boundaries

| Axis | Required client observation | Source/owner |
| --- | --- | --- |
| Ambiguous writes | A network loss after POST does not prove refusal or success. No blind retry or new-key replay. An explicit safe replay preserves the original key and exact content. | Runtime idempotency, lane45 |
| HTTP errors | 401, 403, 404, 409, 422 and transport/protocol failures retain distinct meaning. An error body does not leak headers/tokens, raw provider data or other users' cached facts. | Runtime errors/auth, lane45 |
| Session isolation | Signing out retires pending work and cached sensitive data. A late response from user A cannot become user B's result/cache; authentication is supplied explicitly. | Runtime identity and build brief, lane45 |
| Source time | Upload and read time never replace `capturedAt`; stale samples stay stale. A recent upload response is only the accepted count, not delivery or monitoring. | Runtime locations, PR52/53 |
| Buffer/restart | Finite capacity has explicit loss counts; persisted upload intent retains the same batch/key through ambiguous response and restart. Queues remain scoped to user/trip. | Build brief, lane42 |
| Revocation/stop | A stopped or revoked scope cannot start new uploads or silently reuse another identity. Prior network authorization may already have happened; abort is not proof of server cancellation. | Runtime consent, lane42/45 |
| Claims | Unknown, phone observations, attributed reports, server receipts, acknowledgement and action stay separate. No fabricated route, source time, delivery or safety state. | Runtime, PR52/53 |

The catalog intentionally includes only routes in the pinned runtime contract.
It does not guess future list/discovery routes from lane41. Region, language and
time zone remain explicit; synthetic examples include Brazilian Portuguese.

## Candidate review procedure

Capture an immutable author SHA, archive it into reviewer scratch, read its API
and source, and bind the reviewer probes to its documented injection interface.
Until that interface and frozen candidate exist, passing fixture self-checks
is **not** an author pass. Preserve failing probes unchanged across a fix; publish
actual path/line/reproduction findings only after executing the frozen source.

Lane46 owns real PostgreSQL/signed-identity API and process-restart proof. Align
the above semantics with that suite; a scripted response does not prove SQL
transactions, idempotency persistence, consent enforcement or provider delivery.
Subsequent candidate probes and local reload/offline browser proof belong in this
same reviewer lane once the authors' interfaces and frontend foundation exist.
Physical-device, human, provider and product evidence gates remain open.
