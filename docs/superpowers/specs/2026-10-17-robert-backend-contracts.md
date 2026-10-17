# Robert backend planning baseline

Status: architecture selected by Robert’s delegation in [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md); implementation contracts and evidence remain gated, not completed #12. Product requirements come from `docs/PLAN.md`, revision `evidence-gates-v5-voice-trip-live-sharing`; ownership and existing blockers come from `docs/plan.json`. User-selected execution method: subagent-driven, one reviewed issue slice at a time.

Robert delegated the architectural decision after the independent review. ADR-002 selects AWS ECS/Fargate, RDS PostgreSQL and SQS, and explicitly replaces the global dispatch fence with short transactional per-attempt authorization. This baseline and issue plans must follow that decision. Original owners/blockers and technical (40%), traction (30%) and pitch (30%) evidence remain unchanged; design selection does not prove deployment or safety readiness.

## Product boundary

Independent Latin American freight owner-operators, typically with one or two trucks; Spanish and Brazilian Portuguese. Voice or natural-language text produces a driver-owned draft; only explicit confirmation can register a trip and location-sharing grants. Accepted contacts see current/stale/unavailable location and can act on help, fatigue/rest requests or uncertain missed check-ins. Driver wellbeing, phone liveness, delivery, acknowledgement and useful action remain separate facts.

The 24 Robert issues include three section coordination issues and 21 delivery issues. Planning is authorised now; original evidence gates still govern implementation/closure. Draft contracts and synthetic fixtures do not satisfy driver research, physical-device, provider or independent-review gates. Robert selected Zavu for individual SMS, WhatsApp and voice notifications. AWS topology is selected; account/region, exact runtime versions, transcription/identity/map providers and numeric safety thresholds remain unverified or undecided.

## Confirmed recipient/channel requirement

Robert confirmed this during product brainstorming: the primary emergency contact is a family member or partner; the driver can also select an additional person for the trip/situation. A full emergency alert must attempt SMS, WhatsApp and a phone call to those individual recipients. The selected driver group receives a WhatsApp alert only; membership alone never schedules SMS or individual calls to group members. Include attributed emergency information, event time and latest location with its observation time/freshness, plus driver/truck reference and a response path.

All three individual channels become immediately eligible in parallel, subject to real capacity/quotas. Receipt/acknowledgement does not cancel the other required channels. Only explicit authorized incident resolution cancels future authorizations; earlier authorized attempts can still complete. Recipient-role deduplication is required. Missed-check-in escalation remains disabled until its own evidence-approved policy exists. Group WhatsApp delivery remains required and unverified; manual sharing is not equivalent completion.

## Security SOS and fatigue: distinct meanings

Confirmed by Robert: an explicit help signal for robbery or kidnapping triggers the security emergency flow and its agreed recipient/channel matrix. The exact activation interaction remains to be designed; reporting detail must not be required before sending help. Preserve the driver-reported nature of the incident, including kidnapping in the eventual #18/#29 report contract. ADR-002 selects immediate parallel eligibility per individual channel and separate explicit incident resolution; neither arrival nor OK resolves security SOS.

Robert clarified that ‘I’m OK’ is intended as an active responsiveness/alertness check aimed at avoiding the driver falling asleep; retain that goal rather than replacing it with self-reported tiredness alone. This is a product hypothesis, not validated detection/prevention. He explicitly does not want an invented alert interval. A missed reply remains unconfirmed status; neither a successful reply nor its absence validates wakefulness, detects sleep, or proves that continued driving is safe. Keep check-in cadence, grace and any automatic fatigue thresholds unset pending evidence. The missed-check-in escalation audience/timing is still undecided and must not inherit the security SOS broadcast automatically.

Robert's latest clarification supersedes the earlier spoken-reply-only decision: voice or text is for initial trip entry; subsequent quick actions should use very large buttons, including the check-in response. Exact labels, screen grouping, cue modality and emergency activation mechanics remain design proposals. Large controls do not by themselves qualify visual/manual interaction while driving. Preserve response received, no response and interaction unavailable separately; never map a tap directly to ‘alert/safe to drive’. Assess stationary/simulator usability and the existing #24 moving-interaction evidence before supporting a moving check-in mode. Do not silently restore mandatory spoken replies.

## Phone capabilities and quick actions — latest product direction

Robert wants the phone's GPS/location, speed, geospatial context and available hardware/permissions to inform contextual decisions. This is authorization to investigate relevant capabilities, not proof that every sensor exists or that every permission will be granted. Request permissions when needed for an explained feature and handle denial/revocation explicitly. ADR-002 selects Android installed for initial capture validation and web for contacts/demo; device/framework availability is still to verify with Sebastian.

Candidate inputs: timestamped location with accuracy and available speed/bearing; route geometry/POIs from a separately selected map source; accelerometer/gyroscope observations where available and qualified; battery/connectivity and monitoring availability. Record source and uncertainty. Phone movement is not necessarily truck movement, a stationary phone is not proof of an available driver, and fuel-station proximity does not confirm refuelling. Maps supply geospatial context rather than being an additional phone sensor. No automatic sleep detector or continuous camera/microphone collection is selected.

Proposed quick-action labels for discussion: ‘Estoy bien’, ‘Hacer una parada’, ‘Continuar viaje’, ‘Necesito ayuda’ and ‘Llegué’. Show actions appropriate to the trip state rather than all simultaneously; exact stop reasons and confirmation/accidental-tap handling remain open. Ordinary OK must not resolve security SOS. Sensors can help defer/reassess a check but must not manufacture the driver's confirmation or silently close a trip.

Capability references checked 2026-10-17: [Android sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview) and [location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions). Availability, background behavior, accuracy and battery cost still require qualification on the selected platform and physical phones. [NHTSA distraction guidance](https://www.nhtsa.gov/book/countermeasures-that-work/distracted-driving) distinguishes visual, manual and cognitive demands; button size does not establish safety. Revise #9/#12/#19–27 handoffs around the selected UI and actual capabilities before execution.

Recommendation for discussion, not yet an approved fatigue design: support an explicit tiredness/rest request and a planned rest flow, help coordinate a safe stopping/rest action with a contact, and describe missed check-ins honestly as unknown status. Do not present repeated prompts, calls or alarms as a way to keep driving through sleepiness. Do not enable the draft tiredness-to-shorter-cadence rule merely because its tests pass.

Official guidance checked 2026-10-17: [CDC/NIOSH driver fatigue](https://www.cdc.gov/niosh/motor-vehicle/driver-fatigue/) describes multiple fatigue causes, individual differences and the need for sleep/rest; [NHTSA drowsy driving](https://www.nhtsa.gov/risky-driving/drowsy-driving) recommends stopping safely when sleepy. These support the rest-oriented recommendation; they do not validate an ANDES check-in interval or phone-based detector. Research and physical-device/human-factors evidence are still missing.

## Contextual check-ins and repeated verification — confirmed product intent

Read the [contextual scenario inventory](2026-10-17-contextual-checkin-scenarios.md) during brainstorming and before revising #20/#23–27. Its 24 cases are proposed evaluation inputs, not implemented detection features or approved automatic rules.

Robert clarified that check-ins must depend on the driving situation rather than a universal fixed interval: defer during a curve/demanding maneuver, suspend during refuelling or a declared out-of-truck stop, and seek repeated valid responses before raising a non-response alarm. Preserve this active responsiveness-check requirement; a single silence must not directly become the full emergency broadcast.

A suppressed check is not a failed response. An unavailable/unheard audio prompt is not a confirmed unanswered check. Re-evaluate context and channel readiness before every further attempt; do not replay accumulated prompts immediately after a curve/stop. Keep timestamped attempt identity, eligibility reason, cue/display-delivery evidence appropriate to the selected modality, response/no-response and uncertainty so repeated verification reflects distinct opportunities, not duplicate events. Exact retry count, spacing and response windows remain unset and require justified policy bounds; contextual adaptation must not mean endless retries or silently indefinite reassurance.

Fuel-station proximity alone cannot prove refuelling or that the driver left the cab; unknown context must stay unknown. How the driver declares a stop/resumes, what phone/map evidence can qualify an interaction opportunity and how to handle prolonged inability to check remain open questions. A straight road alone is not proof that prompting is safe. Rest/refuelling pauses check-ins according to the eventual agreement; it must not disable explicit security SOS or silently revoke location sharing.

Before execution, revise #20/#23–27/#29 around distinct states: deferred due to driving context, paused for declared stop, channel unavailable, valid prompt awaiting response, repeated valid non-response, and explicit SOS. The old fixed-cadence policy is a comparison fixture only, not the agreed live product. In particular, expiration of an old grace timer during a curve/stop cannot count as completed repeated verification. Separate check-in episode timing from trip/arrival and coverage-loss policies; those policies remain to be designed. Any escalation from repeated non-response says status unconfirmed, never sleep confirmed. Multiple replies likewise do not establish sustained wakefulness or prevention efficacy.

## Selected implementation shape

One TypeScript codebase with an HTTP API, control worker and isolated emergency/ordinary delivery consumers on ECS/Fargate; RDS PostgreSQL is state authority and SQS Standard is transport. Transactional outbox bridges database commit to queue publication; queues contain IDs/versions only. No SQL connection/lock spans external I/O. Multi-AZ is the robust deployment target, not a deployed claim. Node.js 24 LTS, strict TypeScript/ESM, Fastify 5 and pg remain version candidates pending compatibility verification and pinning; no dependency lockfile exists. No Redis, Kubernetes, Kafka or multi-region deployment in the demo.

Keep source under `src/<domain>/`, tests under `tests/`, SQL under `db/migrations/`, and redacted acceptance records under `docs/evidence/issue-XX.md`. Planned paths do not exist yet. Tests are `.test.mjs`, import compiled `dist/` modules, and use the Node test runner. `npm run build` means `tsc`; `npm run check` means `tsc --noEmit`; `npm test` means `node --test tests/*.test.mjs`. Each issue gives an explicit test-file command after building. Tests that need PostgreSQL require `TEST_DATABASE_URL` pointing to a dedicated disposable test database and must fail clearly when it is absent, not report a skipped test as acceptance.

## Global constraints

- No inferred input or model output may activate a trip, grant location access or establish wellbeing.
- No forced visual/manual response while moving; audio is not presumed safe.
- No new affected dispatch authorization after committed closure/revocation/resolution. Previously authorized attempts may initiate/complete later; never imply recall. Arrival does not resolve a security SOS.
- Recheck current trip and sharing grants for every location read/update delivery; revocation affects existing subscriptions as well as new requests.
- Preserve unknown delivery, stale location, contradictory reports and uncorroborated outcomes explicitly.
- Spanish and Brazilian Portuguese are separate tested language conditions; country, phone prefix and time zone are separate facts.
- Safety thresholds T_action, Delta_action, B_false and B_attention remain unset until #11 supplies justified values.
- Synthetic fixtures and engineering timing targets are not validated safety thresholds or proof of provider/device performance.
- No credentials, raw participant audio, precise participant routes or contact tokens in committed fixtures or logs.
- Keep original owners, blockers and statuses; implementation-ready, evidence-ready and issue-closed are separate states.

## Shared contract ownership

#12 writes the contract decision and `docs/contracts/backend.md`; it does not scaffold an unapproved app. #14 creates the minimal API/test/runtime foundation as part of its first working identity slice. #16 creates trip draft and registration persistence. #18 extends the provisional event envelope already agreed in #12; it does not block #16 by introducing a circular dependency. #27 creates the durable deadline processor; #30 owns notification job execution. #17's cancellation tests can initially use persisted pending work, then must be rerun against #27/#30 actual workers.

One integrator owns edits to package manifests, lockfile, migration numbering, API route registration, `src/contracts.ts` and shared test setup. Assign monotonically ordered migrations at integration time; individual plans use `db/migrations/issue-XX-<purpose>.sql` as their reserved source name, and the integrator records final ordering in the migration manifest. Agents must not concurrently edit shared contracts or migrations.

## Common types and semantics

These are proposed names for #12 to freeze, not runtime code. Each issue defines its own additional input/output types in its domain file; it must not invent a competing common type.

```ts
type Id = string; // UUID validated at HTTP boundaries
type Instant = string; // ISO 8601 UTC instant with Z; source offset/zone stored separately
type Locale = 'es' | 'pt-BR';
type Actor = { driverId: Id };
type ContactCredential = { token: string }; // opaque secret in an authorization header
type Clock = { now(): Instant };
type AppContext = { db: import('pg').Pool; clock: Clock };
type FailureCode = 'invalid_input' | 'unauthorised' | 'not_found' | 'conflict' | 'unsupported' | 'unavailable';
type Result<T> = { ok: true; value: T } | { ok: false; code: FailureCode };
type TripState = 'active' | 'resting' | 'resolved' | 'cancelled';
type EventEnvelope = {
  eventId: Id; tripId: Id; revision: number; kind: string;
  observedAt: Instant | null; receivedAt: Instant;
  source: 'driver' | 'contact' | 'device' | 'server' | 'provider';
  policyVersion: string; payload: Record<string, unknown>;
};
```

HTTP maps invalid input to 400, unauthenticated to 401, conflicting revision/idempotency key reuse to 409, unsupported enabled-mode requests to 422 and temporary unavailability to 503. Cross-owner resource requests return 404 without confirming existence. A supplied body `driverId` never overrides verified authentication. Contact authentication is a separate scoped credential and never becomes `Actor` for a driver. Mutations require authenticated actor, idempotency key and expected revision where an existing aggregate changes. Reuse of the same key and same payload returns the saved result; the same key with a different payload is a conflict.

Contact grants store token hashes, recipient/trip, expiry, revocation and scope `live_map` or `incident_response`; separate grants do not implicitly confer the other permission. #16 owns initial persistence, #21 checks map scope and #29 checks incident scope. #15 supplies consent and frontend handoff. Never include raw tokens in logs or exported evidence.

#16 owns the accepted-contact backend and verified recipient acceptance; #15 owns its consent UI. A driver cannot assert that another person accepted. #21 owns live-map credential issuance/rotation/revocation. Its one-time secret response is an explicit idempotency exception: replay returns stable issuance metadata with `credential:null` and `secretState:'unavailable_on_replay'`; a new key rotates and revokes the old credential. Persist only the map token hash, never a recoverable copy. Replays must never imply that a missing secret was delivered. #14 session replay follows its separately documented encrypted-result contract.

#26 owns authenticated driver check-in/report APIs and the read-only due-state handoff to #24. It appends #25 measurements and attributed help/fatigue outbox intents atomically; #27 consumes durable expiry independently of browser timers. Polling a due state does not establish that a prompt was perceived, or promise background delivery.

Proposed API boundaries: `/v1/identity/*`, `/v1/trucks`, `/v1/trip-drafts`, `/v1/trip-drafts/:id/confirm`, `/v1/trips/:id`, `/v1/trips/:id/commands`, `/v1/trips/:id/locations`, `/v1/contact/trips/:id/location`, `/v1/contact/incidents/:id/actions`, `/v1/provider/callbacks/:provider`. Individual plans define methods, bodies and results before implementation. Audio upload goes through the draft endpoint with a bounded content contract; it must not accept arbitrary URLs for server-side fetching.

Use HTTP polling for the first contact map transport: each request returns the authorised current snapshot, freshness and observation time. It avoids introducing a persistent connection service. #12/#9 freeze a polling/capture cadence and stale threshold from device and latency evidence, not an arbitrary product promise. A page ages its snapshot stale locally between polls. If a later accepted design chooses SSE/WebSockets, active subscribers need grant checks and revocation tests too; that is not permission to add them now.

## Transaction and lifecycle rules

Trip mutation, audit, idempotency and required jobs/outbox commit on one PostgreSQL client/transaction. #17 exports `withTripTransaction<T>(ctx:AppContext,tripId:Id,work:(client:PoolClient)=>Promise<T>):Promise<T>`: a short SQL-only transaction with transaction-scoped trip coordination; errors map at the caller boundary. It never performs external I/O or nests a second transaction. Lock affected rows in consistent order. Provider calls and SQS publication occur after commit and releasing the client.

#30 authorizes one attempt per logical job under current incident/grant/generation checks. An expired claim before authorization cannot authorize; after authorization, loss becomes unknown rather than permission to resend. No global `trips.dispatch_fence` is created. An unknown WhatsApp attempt does not block other channels, contact-map revocation or trip closure. Authorized-before-close attempts can send afterwards; the interface reports that fact. The first version reconciles ambiguous sends through reads/callbacks only, never a blind resend. New attempts require definitive nonacceptance plus prior-emitter quiescence and fresh authorization. See ADR-002 for full ordering and recovery cases.

#29 materializes an explicit SOS with the #31-injected SQL planner in the originating command transaction: incident, per-recipient/channel jobs, unavailable-channel facts and outbox persist together. #26 uses an injected SQL-only effect callback, enabling synthetic tests before the integration exists; production cannot acknowledge SOS acceptance with just a source intent. #30 consumes duplicate queue messages by job identity and recovers scanner/relay work from SQL. No exactly-once provider delivery is promised.

Trip closure stops location and check-ins and cancels uncommitted ordinary authorizations. Security incident resolution is separate. Contact revocation blocks future authorizations for that recipient independently. Reads authorize against current primary state; a read/message authorized before revocation may arrive later and already disclosed copies cannot be recalled. A security SOS continuing after arrival cannot acquire fresh coordinates from a revoked live-map grant. Location samples do not increment lifecycle revision. Store latest qualified sample plus bounded permitted history, never an unlimited route archive.

## Provider and evidence gates

#12 must record actual runtime/hosting access, restart guarantees, database backup/restore, secrets, logs, cost limits and deployment/rollback strategy. #10 supplies eligible identity/messaging channels, recipients, signed-callback contract and limits; #16 additionally requires a selected transcription/extraction service with supported languages, request limits, retention and failure behavior. Adapter contracts can be tested synthetically while real integrations remain unavailable. Do not invent provider endpoints, callback signatures or recovery semantics. Before enabling a provider, extend the relevant issue plan with exact verified SDK/API operations and actual receipt evidence. No deployment, spending, participant outreach or provider activation is performed by this planning change.

#11 supplies numeric safety limits; #9 supplies device/capture limits; #13/#15/#19/#22/#24 supply frontend, consent, capture, map and safe-interaction acceptance. These are execution gates, not missing steps to hide with mocks. #39 supplies consent/retention/withdrawal rules before #40–42 real-data work.

## Test conventions and evidence

Issue tests build expected results independently of implementation output. Use fixed synthetic timestamps and IDs, fake clocks for logic and real PostgreSQL for transactions/races. A 30-second test deadline is a fixture, not a product cadence. Force races with barriers/latches, not sleep-based timing guesses. Test provider acceptance followed by timeout, revoked grants, late events and independent users explicitly.

`tests/helpers/context.mjs` is introduced by #14 and exports `createTestContext(): Promise<{ ctx: AppContext; close(): Promise<void> }>` with an isolated database/schema and deterministic clock. Its schema must be isolated per test run; never point it at participant data. Later plans may introduce explicitly defined fixture helpers in their own files; names in snippets are requirements to implement, not existing utilities.

An acceptance record names the revision, commands/results, failed cases, provider/device evidence references and external reviewer disposition. Missing evidence is marked missing. An AI code reviewer is useful for engineering review but does not replace the required human/device/provider/second-analyst evidence.

## Hackathon providers — Zavu selected; other options under review

Checked 2026-10-17 using official documentation and read-only `andes --output json credits` through the chofex-hackathon skill. No coupon was redeemed, provider account activated, credential installed or message/call sent. Account benefit listings are not proof of an activated provider balance. No redemption codes or private referral URLs are stored here.

- **Zavu — selected by Robert:** provider for #31–33 individual SMS, WhatsApp and voice alerts, pending account/channel qualification. [Official introduction](https://docs.zavu.dev/introduction) documents these channels; [messaging API](https://www.zavu.dev/en/messaging-api) documents explicit channel selection, status reads and signed webhooks. Auto routing chooses a channel; our three-channel emergency requirement needs separate explicit channel attempts, with fallback configured to avoid unintended duplicates. Account instructions say the event coupon becomes available Sunday October 18 and to consult the Zavu team; coupon value/redemption and country-specific operation are unverified. Confirm WhatsApp onboarding/templates, number/voice enablement, costs and recipient delivery before enabling real delivery. No verified existing-group endpoint was found in the reviewed documentation; #34 remains unresolved, not declared unsupported. Broadcasts to individuals are not proof of WhatsApp group delivery.
- **ElevenLabs:** candidate for #16 trip audio transcription. Spoken check-in replies are no longer the selected primary interaction; do not add a continuous transcription dependency for button responses. [Speech-to-text documentation](https://elevenlabs.io/docs/overview/capabilities/speech-to-text/) supports batch/realtime transcription; [audio APIs](https://elevenlabs.io/api) include speech synthesis. Spanish/Portuguese transcription is documented, but truck-cab noise, attribution, phone background/microphone behavior, retention and our latency are untested. Recognition of a reply is not fatigue detection. The [event page](https://hacktheandes.com/) advertises a Startups/Creators program; ElevenLabs was absent from the account benefits response, so actual entitlement requires confirmation.
- **n8n:** optional integration/prototyping tool, with an official [Zavu integration](https://docs.zavu.dev/guides/integrations/n8n). Account benefit: one month of Cloud Pro, limited event licenses and coupon expiry one week after the event. Do not make it the emergency deadline authority merely because credits exist; evaluate durability/cancellation requirements in #12 first.
- **Other account-listed sponsors:** Grok, Exa, Apify, AtomicMemory, Qatom, IALABS (Maritime access), Lovable and Tavily. These are available offers, not selected app dependencies. The CLI lists US$50 Exa Search API credits, 8,000 Tavily credits and a Lovable one-month Pro offer with 100 credits; redemption, quotas and access remain unchecked. Maritime supplies [agent hosting/APIs](https://maritime.sh/docs/api); its fit is optional rather than a requirement for this product.

Robert authorized using Zavu and applicable available Andes credits. Preserve that decision for later setup/redemption; do not ask him to select the same provider again. Use relevant benefits rather than adding every sponsor as a dependency. No benefits have been redeemed yet; implementation still follows the product/architecture review sequence. This authorization does not select the audio provider or establish group eligibility.

`andes` itself provides event/team/project/benefits tooling. No general-purpose app GPS feed, emergency dispatch service or validated alertness detector was identified in the reviewed Andes materials. Phone capture, authorized location storage/delivery, durable incident rules and response ownership still need the app implementation. Public event-page benefits and account-specific offer details differ; recheck actual redemption terms before budgeting or selecting providers.

## Sources for the proposed baseline

- [Node.js releases](https://nodejs.org/en/about/previous-releases): Node 24 is an LTS line; pin a supported patch at execution.
- [Fastify support policy](https://fastify.dev/docs/latest/Reference/LTS/): check runtime compatibility when locking dependencies.
- [node-postgres transactions](https://node-postgres.com/features/transactions): all statements in one transaction must use the same client.
- [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html): row locks and SKIP LOCKED support work claiming; leases, retry semantics and reconciliation still need implementation.
