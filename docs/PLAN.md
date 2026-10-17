# Complete Andes plan

All 63 original nodes are retained below. The 44 task nodes map to GitHub issues; the 19 actions/notes remain explicit flow, gates and context.

<a id="root"></a>
## Project flow

### ANDES · Team GOAT

Project: ANDES (hackathon). Team: GOAT. This project has its own workspace and GitHub repository, separate from SurcoCheck.

Working cohort, not validated demand: independent Peruvian owner-drivers with one or two cars who make regular interurban work trips and already rely on a trusted contact. Spanish first; choose one route corridor from their original journey records. Other Latin American markets remain outside this first validation.

Critical scenario: a driver misses an agreed trip check-in or arrival, and the contact cannot tell whether to act. Intended benefit: reduce avoidable delay to an appropriate contact action without increasing driving distraction or overwhelming contacts. Phone signal -> qualified observation -> bounded check-in -> uncertain-status alert -> contact acknowledgement -> recorded action is the causal chain to test. No claim of preventing crashes or detecting sleep, robbery or weapons.

Incoming flow: Entry/context.

### Validate the promise

Define the initial harm, inventory original evidence and challenge the three claims before choosing the MVP promise. Exit: traceable incident timelines, real-device/provider limits and a preregistered evidence contract; missing evidence remains a gate.

Incoming flow: entry.

### Prepare a safe trip

Make the monitoring limits, driver choices and contact responsibilities understandable before departure. Gate the journey on observed comprehension and safe interaction, with a clear server registration and cancellation contract.

Incoming flow: validate [Evidence passes].

### Track available signals

Capture only supported observations with provenance, freshness and missingness. An independent observer must be able to reproduce what the app knew without mistaking device telemetry for driver wellbeing.

Incoming flow: prepare.

### Adapt safety check-ins

Test H1: bounded adaptive check-ins must add useful information without demanding attention at an unsafe time. Compare the simplest fixed policy and current contact practice before accepting added adaptation.

Incoming flow: track.

### Escalate and resolve

Test H2: persist deadlines, qualify uncertainty and progress from delivery to human action. Gate each promised channel on observed receipts and contact behaviour, including ambiguous failures and unavailable recipients.

Incoming flow: checkins.

### Verify and pilot

Use predefined scenarios, an independent reviewer and baseline comparisons. The five existing verification axes gate a bounded future pilot; pilot feasibility never establishes reduced crashes or robberies.

Incoming flow: escalate.

### Driver MVP decision

Read the evidence contract and independent review: proceed with the supported promise, simplify/revise it, or stop. Unknown evidence is not a pass. A small pilot can establish feasibility and measured response performance, not crash/robbery reduction. The shared-data branch starts only if driver value, appropriate consent and its separate evidence gate are met; failing the MVP gate freezes it.

GitHub handover: the owner has authorised publishing this plan as open issues now in Bimbi-Dev/andes-hackathon and inviting Robertzu43 with write access. Keep completed implementation work in this same independent repository and publish it after its applicable checks pass. Check the actual repository owner, remote revision and invitation/access result. Record the repository URL and evidence; a pending invitation is not accepted access. Never publish credentials, participant data or SurcoCheck material. This GitHub handover does not authorise hosting deployment, participant recruitment, messaging-provider activation or new spending.

Incoming flow: verify.

### Learn from shared data

Later conditional phase for H3. Separate operational observations, self-reports and independently corroborated outcomes; require exposure, missingness, policy-bias and privacy checks before any aggregate release.

Incoming flow: candidate [Data gates pass].

### Evidence review complete

Record supported claims, rejected assumptions and unresolved questions. Additional markets, platforms and institutional reporting remain later decisions requiring their own evidence and authorisation; they are not new workstreams in this upgrade. Preserve adverse results and the unchanged scope.

Incoming flow: insights.

### GOAT project and delivery

Authorised now: publish this existing Codus plan as open GitHub issues in the separate private Bimbi-Dev/andes-hackathon repository, team GOAT, and invite Robertzu43 with write access. The seven sections, 63 nodes and 44 task nodes retain their scope. App implementation, provider activation, participant recruitment, trip collection and live pilots have not started.

ANDES is separate from SurcoCheck, with independent code, configuration, data and delivery ownership. Before starting a section, satisfy its evidence gate. Missing or inconclusive evidence is not a pass. Use issue closure only for completed work supported by evidence. Invitation acceptance must be reported separately from sending the invitation. Hosting deployment, spending and live pilots remain separately scoped.

Incoming flow: Entry/context.

### Three claims to test

H1: a bounded check-in can obtain useful status without unsafe distraction. H2: escalation can get an appropriate trusted-contact action sooner than current arrangements under supported conditions. H3: contributed observations can describe response patterns; stronger fatigue/crime/road-risk claims need independent outcomes.

Heartbeat means an “I’m OK” check-in, not cardiac pulse. Device liveness, prompt delivery, driver response and wellbeing are different facts. An OK reply is time-specific self-report; a missing reply is unknown. A careful driver on a curve may respond slowly. More prompting on that curve can manufacture a misleading hotspot.

Incoming flow: Entry/context.

<a id="validate"></a>
## Validate the promise

### Reconstruct real trip incidents · #8

Claim: the initial cohort experiences avoidable delay between an unconfirmed trip status and useful contact action. Start from original driver/contact accounts and consented timestamps, not competitor marketing or founder summaries.

Smallest proposed collection after separate authorisation: five driver-contact pairs, each reconstructing one recent worrying trip and one ordinary trip using a critical-incident interview. Record what each person knew at each time, actions, decision cues, missed opportunities, and available GPS/message/call records; redact unrelated third parties. Five pairs are exploratory, not a prevalence or efficacy sample. Do not require a genuine emergency history to qualify.

Tools: recorded interview/transcript with consent and a spreadsheet timeline with source IDs, observed versus recalled timestamps, contradictions and uncertainty. Compare with their actual WhatsApp/call arrangements and include harmless late replies. Independent criterion: both participants review their own account; a reviewer outside implementation can trace the claimed intervention window to source records. Change/stop: if records show no actionable window, nobody available to act, or no unmet problem, revise the scenario before building. Output: cohort brief, evidence inventory and baseline timelines.

Entry in this section.

Codus node: `pn_mvcq4kwy_8aaba1`

### Test phone capability limits · #9

Claim: the proposed observation/check-in flow works in explicitly supported phone states. Evidence required: physical-device traces for representative cohort Android and iPhone models, OS/browser versions and installed-PWA state; browser emulation is insufficient.

Method/tools: Chrome remote debugging or Safari Web Inspector, a separate timestamped observer log and server event logs. Test foreground, locked screen, background/navigation, permission denial/revocation, battery saver, offline/reconnect and phone shutdown. Check GPS freshness, motion permission, notification delivery and any audio/response mode separately; measure battery/data use against the same journey without the app. Do not assume SIM-number or battery APIs exist.

Accept: each promised state has reproducible device evidence, and every unavailable state is explicitly degraded/unsupported. No supported state may imply continuous monitoring after evidence becomes stale. Change: if the critical scenario needs continuous locked-screen capture the web app cannot establish, narrow the promise or record a later native-platform decision; do not add that build now. Outcome: capability matrix with raw logs, limits and repeatable cases.

Incoming flow: Reconstruct real trip incidents.

Codus node: `pn_mvcq4l8x_bee2e7`

### Verify channel evidence · #10

Claim: opted-in contacts in the initial country can receive the promised channels and respond. Use current official WhatsApp/SMS/voice documentation and later designated sandbox/test-recipient receipts; document country coverage, account eligibility, templates, consent, costs and callback meanings.

For colleague groups, verify official account eligibility and support for the actual existing-group use case. An API mention alone is not proof our account or group works. Tools: provider dashboard/sandbox, signed webhook logs and a separate recipient observation record. A mock establishes only internal logic.

Accept: every promised channel has traceable message/call IDs, observed recipient arrival and an explicit acknowledgement path. If blocked, preserve the requirement as conditional and plan opted-in individual delivery or stationary manual sharing; no unofficial automation. Freeze fallback order/deadlines only after observed timing and the incident window are known. No live provider activation or outbound contact is authorised by this planning update.

Incoming flow: Test phone capability limits.

Codus node: `pn_mvcq4lke_4912d2`

### Set evidence and stop gates · #11

Create the decision contract before implementation or outcome inspection. Use a bounded STPA analysis of driver, phone/web app, server, provider and trusted contact: losses are added distraction, missed/late useful help, false alarm burden and inappropriate location disclosure. Model missing, early/late, excessive or stale prompts/escalation and inadequate human feedback. Draw one control diagram and a hazard-to-test table; do not turn this into a general certification exercise.

For H1, H2 and H3 record claim -> source evidence -> test -> independent acceptance criterion -> revise/stop result. Register the baseline and the units: delivered/eligible prompts, trip, covered driver-hour, contact action and independently labelled event. Choose T_action (latest useful action time), Delta_action (minimum worthwhile improvement), B_false (maximum tolerable unnecessary escalations per driver-hour) and B_attention (interaction limit). Numeric values are UNSET until reconstructed timelines, baseline variation, contact tolerance and an independent human-factors review justify them. Unset values block the pilot; they are not defaults to invent.

Operational burden uses all registered active trip-hours, including sensor/network gaps, with trip-end censoring defined in advance. Do not discard an outage from the denominator while counting the alert it caused. Road-segment rates use separately qualified location-covered exposure; never reuse that denominator for overall alert burden.

Zero-tolerance deterministic gates: no forced screen interaction to prevent an alarm while moving; no stale post-resolution escalation; no unsupported wellbeing assertion; no unauthorised route disclosure. Passing scripted cases proves those cases only. Accept the web-first MVP only with these gates and traceable capability limits. If core harm cannot be mitigated within them, simplify the policy or stop the promise.

Incoming flow: Verify channel evidence.

Codus node: `pn_mvcq4lwg_71ec5d`

### Record evidence-led decisions · #12

Use the separate ANDES (hackathon) workspace for team GOAT; select stack and supervised queue after the capability/claim gate. Record which observation, deadline, contact action and consent state each component owns, and attach each architecture choice to a failure scenario. Do not use SurcoCheck as the project, repository or deployment target. No automatic reuse of its municipal code, configuration, data or the obsolete camera hypothesis; no assumed existing routes/files. The Andes repository is Bimbi-Dev/andes-hackathon; Robertzu43 is the authorised write collaborator.

Deliver a small architecture decision record, the check-in/escalation state machine and versioned event contracts. Server-owned timers plus a transactional outbox are required where browser loss must not discard agreed deadlines; external sends run through supervised jobs with reconciliation and observable status. Testability must include deterministic clock/event replay, raw evidence export and exact policy/revision provenance. Independent review must trace every safety constraint to an owner and test. If a constraint has no implementable owner, keep it unresolved before feature build.

Incoming flow: Set evidence and stop gates.

Codus node: `pn_mvcq4m7h_1e9695`

### Evidence available and missing · note

Available now: the user's original product description; the existing native plan and local spec; the user's clarification that Chofex's CEO only made a Samsara comparison, with no unmet-need evidence or pilot offer (Brain note 1842). The old freight-vision validation.json contains public/sample-video vehicle/dwell smoke tests, including a failed parking case; it does not validate phone-based check-ins or real drivers. Source: the separate freight-vision prototype validation.json, retained in the private research archive and not bundled with this repository.

Not supplied/collected for this mobile hypothesis: original driver/contact interviews, consented real journey traces, communication logs, phone lifecycle measurements, provider receipts, independent incident labels or baseline response/burden measures. Their absence is an evidence gap, not evidence that the hypothesis passes. The smallest acquisition exercise is in Reconstruct real trip incidents; device and channel tasks specify their own missing measurements.

Primary references checked 17 October 2026: MIT STPA methods https://psas.scripts.mit.edu/home/books-and-handbooks/ ; attention/distraction https://www.nhtsa.gov/book/countermeasures-that-work/distracted-driving ; geolocation https://www.w3.org/TR/geolocation/ ; Web Push https://webkit.org/blog/12945/meet-web-push/ . These support methods/platform constraints, not this product's efficacy or compliance in Peru. Previously reviewed device permission reference: https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static . Meta Groups documentation was rate-limited in the earlier review; account/existing-group capability remains unverified. No new customer research has been performed by upgrading this plan.

Entry in this section.

Codus node: `pn_mvcq4mpt_a00d76`

<a id="prepare"></a>
## Prepare a safe trip

### Validate the mobile journey · #13

Map Home, Cars, Trusted Contacts, Start Trip, Active Trip, Check-in, Alert Status, Contact Response, Trip Summary and Privacy. Use a low-bandwidth Spanish-first clickable flow, large targets, screen-reader labels and clear permission states. Setup takes place while stationary.

Evidence gate: observed task walkthroughs with representative drivers/contacts, screen recordings and teach-back of what “unknown”, last location and alert acknowledgement mean. Every critical task must be completed and limits explained without facilitator rescue; record all confusion before revision. A stationary walkthrough establishes comprehension, not driving safety. Driving interaction requires the separate human-factors gate. Remove typing and any requirement to look/tap while moving to prevent an alarm. A visually polished screen cannot close this task without the observation record.

Entry in this section.

Codus node: `pn_mvcq4rfu_e36ab0`

### Verify driver and cars · #14

Create driver-entered phone verification and one/two-car profiles with a nickname and useful identification. Do not infer SIM number or identity from browser access. Include recovery, number change and shared-car assignment; car ownership alone never grants covert location access.

Acceptance evidence: designated test-account verification/recovery logs, expired/reused-code cases and cross-driver access tests. The acting driver's explicit trip selection must determine which contacts and car are associated. A second tester must confirm number recycling or shared cars cannot expose another driver's history. Unresolved identity/permission ambiguity blocks trip sharing.

Incoming flow: Validate the mobile journey.

Codus node: `pn_mvcq4rrf_96d642`

### Validate the trusted circle · #15

Capture accepted/pending/rejected/revoked contacts, channel preferences, escalation order and per-trip sharing consent. No unconsented address-book upload. Response links are scoped, expiring and revocable.

Claim: a named contact is willing and able to take a useful action, not merely reachable. Walk through an unconfirmed-trip scenario and a “cannot assist” response using the contact's current arrangements as baseline. Record comprehension, availability and their chosen safe next action. Accept only if the role and handoff are understood and unavailability has an honest terminal state; acknowledgement is not assumed to mean help. If no contact can act, revise the promise before enrolling that trip. No automated emergency-service dispatch is included.

Incoming flow: Verify driver and cars.

Codus node: `pn_mvcq4s7y_319dc6`

### Register the trip and limits · #16

Before departure select car, destination/expected arrival, optional route, planned stops and accepted contacts. Explain the tested capability limits and policy; check permissions while stationary. Server acknowledgement must confirm durable trip and deadline registration before showing monitoring configured.

Test with dropped start responses, offline setup, denied sensors, unavailable channels, refresh and duplicate submit. Accept: the independent observer can reconcile the displayed state with one server trip and one valid deadline; an unknown registration never displays active coverage. A timed-check-in-only mode must name its limits, and lack of contact delivery capability must remain visible. Avoid an unqualified “protected” claim. Unregistered trips cannot be silently treated as covered.

Incoming flow: Validate the trusted circle.

Codus node: `pn_mvcq4sje_2fe977`

### Prove pause and arrival rules · #17

Model planned rest, extension, cancellation and arrival with explicit server acknowledgement. Pause/extension has a bounded new deadline; arrival cancels future check-ins and escalation jobs. Already sent alerts receive a scoped resolution update where possible. Contact acknowledgement cannot declare the driver safe.

Acceptance evidence: deterministic event replay of arrival versus worker dispatch, delayed offline closure, repeated taps, restart and expired pause. Zero obsolete escalation may be initiated after committed resolution; if the provider already accepted a send, record that fact and reconcile rather than promise recall. The same final state must appear on Active Trip, Contact Response and Summary. Preserve unresolved contact/driver disagreement and retest the failing race.

Incoming flow: Register the trip and limits.

Codus node: `pn_mvcq4suz_0018d2`

<a id="track"></a>
## Track available signals

### Define auditable trip events · #18

Schema: event/trip/session ID, sequence, source time, server receipt time, timezone, revision/policy version, permission/visibility, GPS accuracy/age and provenance. Represent device liveness, scheduled prompt, accepted send, observed delivery, response, reported wellbeing and independent incident outcome separately; unknown stays explicit.

Tooling: versioned data dictionary, labelled JSON fixtures and SQL reconciliation queries. Observer ground truth is stored separately from model/rule outputs and preserves disagreement; do not let an alert label its own “incident”. Acceptance: another engineer reproduces the trip timeline and denominators from raw events, including duplicate, out-of-order and clock-skew cases. If source/receipt times cannot be reconciled, mark uncertain latency instead of inventing precision.

Entry in this section.

Codus node: `pn_mvcq4wd4_d71f24`

### Qualify phone observations · #19

Capture permission-gated GPS/motion only in the tested device matrix. Label quality, route progress and candidate motion changes; phone drops, potholes, handling and passenger movement remain confounders, not confirmed crashes/assault/sleep.

Use safe stationary handling and controlled recordings with separate observer timestamps to test these confounders. Compare battery/data consumption with a matched no-app session. Accept only observations whose provenance, freshness and resource cost fit the preregistered capability budget; unsupported raw streams stay unavailable. Remove a motion rule that adds false concern without independently observable benefit. Do not add computer vision or medical sensing to repair the hypothesis.

Incoming flow: Define auditable trip events.

Codus node: `pn_mvcq4wu8_92366b`

### Qualify road and time context · #20

Attach local hour, elapsed trip time, time since reported break, road segment and mapped curves/rest stops to observations. Preserve map source/version and map-match confidence; cached/batched provider enrichment should not block urgent deadlines.

Compare representative traces with independently reviewed locations, including parallel roads, poor GPS and passing a petrol station without stopping. Accept only matches supported by position uncertainty; otherwise retain unknown context. A nearby station cannot establish a safe stop, and a curve cannot justify pressuring a driver to respond. Geometry/time may inform conservative deferral; they do not establish sleep or crime risk. Reject context rules whose benefit depends on precise map knowledge the phone cannot supply.

Incoming flow: Qualify phone observations.

Codus node: `pn_mvcq4x6a_a6e550`

### Make coverage gaps explicit · #21

Buffer bounded telemetry, retain observation time and reconcile after reconnect without animating an old point as live. Server deadlines survive page loss but observe missing contact, not its cause. Battery death, stolen/unavailable phone, app suspension and network loss are indistinguishable unless independent evidence separates them.

Fault cases: airplane mode, screen lock/background, browser kill, shutdown, delayed batch and reordered upload. The external observer records when availability changed. Accept: no fresh location/wellbeing claim inside an unobserved interval; last confirmed position/time and uncertainty remain visible, and agreed lost-contact action follows server deadlines. Do not “fix” missing coverage by escalating indefinitely or inventing a cause.

Incoming flow: Qualify road and time context.

Codus node: `pn_mvcq4xju_95fa11`

### Verify monitoring-state truth · #22

Active Trip and Contact Response separately show last driver response, last usable location, server deadline and notification state. No browser timer or silent push is the sole owner of an agreed contact deadline.

Compare UI state, device observer log and server event trace through suspension, permissions loss, restart and reconnection. A driver/contact must correctly explain what is known and unknown in a walkthrough. Accept zero false live-monitoring assertions in required fixtures. Any confusion that could delay help or create false reassurance reopens the capability/UX gate; activity indicators alone do not prove safety.

Incoming flow: Make coverage gaps explicit.

Codus node: `pn_mvcq4xwo_59a114`

<a id="checkins"></a>
## Adapt safety check-ins

### Specify a falsifiable policy · #23

H1 claim: a bounded policy can obtain useful driver status at acceptable attention cost. Baselines are the cohort's existing contact arrangement and a simple fixed safe check-in schedule. Start with the simplest policy; add context only if a prespecified comparison supports it.

Use a state/rule table with policy version, eligible opportunity, quiet/defer reason, maximum reminders, grace deadline and fallback. Inputs may include trip duration, reported break, local hour, road uncertainty and recent responses, but a missed reply is unknown and an OK reply is time-specific self-report. Define no-response/delivery-unknown/planned-pause separately.

Evidence: incident timelines, device limits and the STPA hazard table. Accept when every action has a safe timing rationale and traceable test; freeze numeric cadence/bounds before evaluation using the evidence contract. Change/stop if the policy needs touch/visual attention during demanding driving, continuously increases prompts, or cannot outperform a simpler safe arrangement. An opaque risk score is outside this MVP.

Entry in this section.

Codus node: `pn_mvcq51hd_759a61`

### Test safe check-in interaction · #24

Offer OK, rest and help only through verified interaction modes. Ordinary visual/manual prompts are deferred while moving; uncertain road context defaults to conservative handling. A driver must never touch/look at the phone merely to prevent an alarm. Audio/hands-free is a candidate to validate, not a presumption of safety.

Method: stationary usability first, then simulator or appropriately supervised closed-course assessment by an independent human-factors reviewer before any moving interaction. Compare eyes-off-road, task errors, interaction time and driving-performance indicators with the baseline using prespecified B_attention. Self-reported ease alone does not pass.

Acceptance: all mandatory suppression cases pass and the assessment stays within the justified attention limit. If such testing is unavailable or fails, retain stationary/planned-stop responses and server lost-contact handling. Never test by inducing fatigue or an actual roadside emergency.

Incoming flow: Specify a falsifiable policy.

Codus node: `pn_mvcq51tf_28691e`

### Separate delivery from response · #25

Store scheduled, dispatched, provider-accepted, available delivery/observation, client response and server-received timestamps separately with clock uncertainty. Provider delivery does not prove the person perceived a prompt. Report delivery-to-response only as that operational interval; claim perception-to-response only if independently observed.

Keep missing delivery, suppressed opportunities and unanswered delivered prompts explicit and censored where appropriate. Retain eligible opportunities, local hour/segment, rule version and deferral reason so more frequent prompts do not manufacture risk. Test delayed networks, phone idle, duplicate responses and impossible clock order in labelled fixtures. Accept when a second analyst reproduces the intervals and denominators from raw events. Reject any driver score that conflates network or safe deferral time with tiredness.

Incoming flow: Test safe check-in interaction.

Codus node: `pn_mvcq524q_291400`

### Test adaptive follow-up rules · #26

Replay OK, tired self-report, explicit help, unanswered delivery, delivery unknown and planned rest as separate states. OK returns to the agreed bounded cadence; tiredness offers a safe stopping option and an authorised contact update; explicit help takes the urgent path. A missed check-in follows bounded grace then an uncertain lost-contact alert, not a robbery diagnosis.

Counterexamples: a careful driver ignores a curve prompt; a message arrives after arrival; phone stolen/offline; a passenger replies; a stale OK arrives after a newer help request. Accept: unsafe opportunities are deferred, late events cannot erase current help state, and no response grants indefinite reassurance. Compare added adaptation against the fixed safe policy on held-out scenarios. If it adds burden or only reclassifies noise, keep the simpler policy and record the rejected rule.

Incoming flow: Separate delivery from response.

Codus node: `pn_mvcq52sw_695a01`

### Prove deadline and race handling · #27

Persist trip state/deadlines before supervised scheduling; apply per-trip version checks and idempotent event handling. Server expiry may trigger a pre-agreed “unable to confirm status” alert with last-seen age even when the browser disappears. It cannot establish what happened to the driver.

Tools: fake clock/event replay, worker restart, delayed callbacks and independent expected-transition fixtures. Exercise arrival versus expiry, help versus late OK, duplicate jobs, long outage and extension versus queued send. Accept zero stale dispatch or missed required transition in the defined suite, with measured scheduler lag within the contract. Any ambiguous send is reconciled as unknown until evidence resolves it. Failures reopen this gate rather than being hidden by retry counts.

Incoming flow: Test adaptive follow-up rules.

Codus node: `pn_mvcq5359_fe25ec`

### Compare benefit and burden · #28

Use the same independently labelled safe scenarios for current practice, fixed policy and adaptive policy; counterbalance order in stationary/simulator sessions. Define useful status as information that changes an appropriate contact decision, not clicks. Later pilot observations are a separate evidence tier.

SQL/Python measures: useful status per eligible opportunity, prompts and unnecessary escalation per registered active trip-hour including coverage gaps, unanswered delivered prompts, B_attention measures and missed actionable situations. Keep driver/route/time clusters separate; tune on development scenarios and hold out whole drivers or journeys for evaluation. Preserve failures and confidence intervals.

Accept adaptation only if it meets the preregistered benefit/attention limits without exceeding B_false compared with the simpler policy. Small or inconsistent evidence is inconclusive, not a reason to tune on the holdout. No improvement means remove adaptation; observed distraction means stop moving interaction. These are gates within the existing task, not extra product features.

Incoming flow: Prove deadline and race handling.

Codus node: `pn_mvcq53mc_508b10`

<a id="escalate"></a>
## Escalate and resolve

### Define action and uncertainty · #29

H2 claim: appropriate contact action occurs sooner than under current arrangements. State machine: active -> check-in due -> bounded grace -> lost-contact escalation -> contact acknowledged/action pending -> resolved; explicit SOS has its own urgent route. Also represent unable-to-deliver and no-contact-available without declaring success.

Define useful action from the incident timeline before testing: for example a contact attempts direct communication and follows the agreed next step, or arranges appropriate assistance. A delivered message, answered call or clicked acknowledgement is not help. Preserve who reported what and when; driver confirmation is separate.

Accept: independent scenario labels map every transition to an appropriate action and uncertainty statement. No response must never become “robbery confirmed”. If nobody can reasonably act within T_action, narrow the service promise; provider delivery alone cannot rescue it.

Entry in this section.

Codus node: `pn_mvcq57ru_d409aa`

### Prove durable notification jobs · #30

Use the selected stack's supervised queue, durable deadline scheduler and transactional outbox. Handlers atomically persist state/outbox, return promptly and expose status; workers perform external sends. Health checks expose stuck timers/jobs. Reliability, external side effects and cost justify jobs rather than request-bound sends.

Evidence: crash/restart and duplicate-dispatch traces tied to trip/incident/version/recipient/channel keys. Test failure before/after DB commit and provider acceptance. Accept: persisted work survives worker loss; obsolete work is cancelled; ambiguous acceptance remains observable and reconciled. Local deduplication cannot prove exactly-once upstream delivery. Do not choose an infrastructure stack until architecture decisions exist.

Incoming flow: Define action and uncertainty.

Codus node: `pn_mvcq58gp_395557`

### Qualify contact notifications · #31

Send incident/stage/recipient/channel attempts with the observed status, last location and age, driver/car reference and scoped response link. Use verified WhatsApp one-to-one templates, SMS fallback and voice according to a pre-agreed priority/deadline policy. Payload minimisation and contact opt-in apply to every route.

Evidence: sandbox/authorised-recipient logs plus recipient screenshots or observation, with IDs and timestamps. Test unavailable channels, expired links, wrong/revoked contacts and language comprehension. Accept: recipients understand what is uncertain and what action is requested; sending fits T_action and never discloses a full route unnecessarily. Unproven channels remain disabled/conditional. This plan edit sends nothing.

Incoming flow: Prove durable notification jobs.

Codus node: `pn_mvcq58ts_414113`

### Separate receipt from action · #32

Authenticate provider callbacks and record available queued/accepted/delivered/failed/answered states with provider IDs. Keep these separate from explicit contact acknowledgement, attempted action, assistance arranged and driver-confirmed status.

Reconcile callbacks against an independent recipient/observer timeline, including voicemail, delivered-but-unread, duplicate and out-of-order callbacks, and a contact who acknowledges then cannot help. Accept zero conflation of delivery/answer with useful action; late provider updates cannot regress a resolved incident. Unknown or unverifiable action remains labelled as such. Measure both acknowledgement and action latency rather than reporting whichever looks better.

Incoming flow: Qualify contact notifications.

Codus node: `pn_mvcq597s_396408`

### Bound retries and reconciliation · #33

Set bounded retries/backoff and fallback deadlines within the evidence contract. Honour provider limits; permanent errors stop. Use upstream idempotency only where verified. After an ambiguous timeout, reconcile provider IDs/status before any retry that might duplicate a warning.

Fault-inject acceptance followed by timeout, duplicate callbacks, queue restart, exhausted recipients and arrival during retry. Accept: every external attempt has a reason and final known/unknown state, and no new obsolete send starts after committed resolution. If upstream status cannot be resolved before T_action, apply the documented alternative channel with uncertainty and account for possible duplication; do not silently mark failure/success. Stop retry storms and report unavailability when all routes are exhausted.

Incoming flow: Separate receipt from action.

Codus node: `pn_mvcq59rg_7e0949`

### Gate colleague-group delivery · #34

Keep colleague-group notification conditional on current official-provider eligibility and actual target-group support. If unavailable, retain opted-in individual colleagues and stationary manual sharing by a driver/contact. No unofficial personal-account automation.

Test scoped expiring links, revoked members, minimal payload and one clear response owner; group membership is not permission for continuous history. Independent walkthrough evidence must show that sharing does not leave everyone assuming somebody else will act. If there is no confirmed responder, status stays action pending. Group support cannot block a useful one-to-one MVP or be claimed from documentation alone.

Incoming flow: Bound retries and reconciliation.

Codus node: `pn_mvcq5a3m_491aa7`

### Verify useful contact action · #35

Contact view distinguishes “I’m contacting them”, “Help arranged”, “Cannot assist” and recorded resolution. Name the acting contact, avoid conflicting ownership, and hand off inability explicitly. Send scoped resolution updates only to already-alerted authorised recipients; preserve the event timeline.

Acceptance evidence: independently observed scenario outcome and participant account, not just button clicks. Test unavailable first contact, conflicting reports, accidental acknowledgement and driver offline after help is arranged. Measure time to the predefined useful action and unresolved cases. A contact report is attributed self-report until corroborated. Country-specific emergency guidance requires verification; automated authority dispatch or a rescue guarantee is outside the initial promise.

Incoming flow: Gate colleague-group delivery.

Codus node: `pn_mvcq5alm_7d649c`

### Test channels against ground truth · #36

Use designated test recipients and real provider sandbox evidence where available. Prelabel the expected result for WhatsApp failure/SMS fallback, unanswered voice/voicemail, explicit acknowledgement, opt-out, all contacts unavailable, ambiguous acceptance, duplicate callback, worker restart and cancellation races. No real emergency is induced.

Tools: provider IDs/receipts, signed webhook log, fake clock for server timing and an independent contact observer. Acceptance: all critical state/privacy invariants hold, each promised route has actual delivery evidence, and action outcomes are reported separately. Capture cost and time by channel; no mock substitutes for physical delivery. Unsupported modes are excluded, failures reopened, and timing beyond T_action requires policy/channel revision.

Incoming flow: Verify useful contact action.

Codus node: `pn_mvcq5axp_b3a938`

<a id="verify"></a>
## Verify and pilot

### Run preregistered scenarios · action

Future verification only, after the evidence contract is fixed. Use synthetic/consented records and designated recipients. A reviewer outside implementation prepares expected outcomes without seeing rule outputs. Required scenarios: normal arrival, harmless ignored prompt on a curve, planned rest, delayed delivery, no signal/phone shutdown, explicit SOS, unavailable contacts, duplicate/ambiguous send and late response after resolution.

Run current practice and proposed policy on matched safe scenarios; retain development/holdout separation. Save revision, configuration, device versions, observer labels, source/receipt clock uncertainty and every failure. A scenario matrix maps each H1/H2/H3 constraint to an existing verification axis. No real emergency, deliberately tired driving or external contact is authorised by this plan edit.

Entry in this section.

Codus node: `pn_mvcq5lk1_fd0e00`

### Attention and UX pass? · action

Use browser_navigate/screenshot/click/fill plus accessibility checks at 390x844, 360x800 and desktop. Verify all screens and permission/degraded states, with console/network evidence. Physical-device and observed-comprehension records supplement screenshots.

Pass requires no forced manual/visual response while moving and a successful independent human-factors assessment for any proposed moving interaction against B_attention. Audio alone is not a pass. Where assessment is missing, only stationary-response mode can be eligible. A critical misunderstanding or increased attention burden takes the No branch; preserve the failing observation and revise the interaction rather than relaxing the gate.

Incoming flow: Run preregistered scenarios; Fix the mobile journey [Retest].

Codus node: `pn_mvcq5lw6_a4fed2`

### Fix the mobile journey · action

Repair layout, accessibility or unsafe interaction in the failing screens, then rerun the same mobile scenarios. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Attention and UX pass? [No].

Codus node: `pn_mvcq5ma5_740ad7`

### Trip state and meaning pass? · action

Replay start/unknown registration, rest/extension, arrival, cancellation, late OK, explicit SOS and contact acknowledgement. Inspect Home, Cars, Contacts, Active Trip, Check-in, Alert Status, Contact Response, Summary and Privacy for shared-state regressions.

Independent expected transitions must match UI/server events through duplicate submit, concurrent actions, offline closure and cross-trip isolation. Pass requires no stale alert initiation after resolved state, no acknowledgement mistaken for driver safety and no erased help request from an older OK. Unknown state remains explicit. Any critical mismatch follows the No repair branch.

Incoming flow: Attention and UX pass? [Yes]; Fix trip state transitions [Retest].

Codus node: `pn_mvcq5mlq_44831e`

### Fix trip state transitions · action

Repair the failing state transition or access boundary, then rerun the lifecycle scenarios and affected screens. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Trip state and meaning pass? [No].

Codus node: `pn_mvcq5mxk_82f2d6`

### Delivery and action pass? · action

Verify actual WhatsApp/SMS/voice sandbox or designated-recipient side effects, signed callbacks, transient failure, ambiguous acceptance, idempotency, opt-out and cancellation. Compare provider receipts with independent recipient observations; group delivery passes only with verified official eligibility and target-group support.

Pass requires separate records for delivered, acknowledged and useful action, plus honest all-contacts-unavailable and channel-exhausted states. Required deterministic invariants have zero violations; observed timing must fit the frozen T_action. A mock receipt or “answered” voicemail cannot pass contact action. A failure or unsupported promised channel takes the No branch to repair or narrow the promise.

Incoming flow: Trip state and meaning pass? [Yes]; Fix dispatch or reconciliation [Retest].

Codus node: `pn_mvcq5na7_c5a587`

### Fix dispatch or reconciliation · action

Repair the queue/provider/callback handling or remove an unsupported channel promise; rerun the same delivery and retry cases. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Delivery and action pass? [No].

Codus node: `pn_mvcq5nxe_d38509`

### Coverage failures stay honest? · action

Inspect browser_console/network, device observer records and scheduler/worker logs through screen lock, background navigation, browser kill, phone shutdown, permission revoke, battery saver, GPS drift, phone handling, clock skew and prolonged outage.

Pass requires timestamp-correct degraded/unknown displays, server deadline recovery and no invented cause for lost phone contact. Check actual battery/data and scheduler lag against the frozen budgets. Any unsupported “live/safe” assertion or missed required transition fails regardless of happy-path success. Unavailable physical-device evidence means unsupported, not passed.

Incoming flow: Delivery and action pass? [Yes]; Fix degraded operation [Retest].

Codus node: `pn_mvcq5og8_b5b0b5`

### Fix degraded operation · action

Repair expiry, buffering, freshness or capability handling, then repeat the failed physical-device and server-failure cases. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Coverage failures stay honest? [No].

Codus node: `pn_mvcq5os4_f8cbc4`

### Evidence and access pass? · action

Test expired/revoked links, cross-user access, opt-out/deletion, payload scope and aggregate suppression. A second analyst recalculates denominators/intervals from labelled fixtures, checks policy-induced hotspots and verifies that driver-hour exposure is not fabricated during missing coverage.

An independent reviewer must trace every outward claim to evidence and distinguish feasibility, association and safety outcome. Pass requires zero critical access violations in the suite and no unsupported sleep/robbery/danger label. Later aggregate outputs may remain deferred without blocking the driver MVP, but operational consent and event provenance must pass. Preserve negative findings and follow the No branch on any critical failure.

Incoming flow: Coverage failures stay honest? [Yes]; Fix access or measurements [Retest].

Codus node: `pn_mvcq5p44_70e1c8`

### Fix access or measurements · action

Repair permissions, data minimisation or analytic definitions, then rerun the specific privacy/measurement checks. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Evidence and access pass? [No].

Codus node: `pn_mvcq5pf4_72f791`

### Pilot eligibility reviewed · action

All applicable axes pass on the same revision with source evidence and an independent reviewer disposition. Freeze the protocol, threshold values/rationale, supported devices/modes and unresolved exclusions before a pilot. Log the verification result only after tests actually run; current nodes remain todo.

An untested promised mode, unset T_action/Delta_action/B_false/B_attention or unresolved critical hazard blocks live pilot eligibility. Verified feasibility is not evidence of reduced crashes or robberies. This state neither deploys nor authorises participant recruitment.

Incoming flow: Evidence and access pass? [Yes].

Codus node: `pn_mvcq5pql_d275be`

### Compare a bounded pilot · #37

Future execution after separate authorisation only. Use the initial Peruvian owner-driver cohort and one evidence-selected corridor with accepted contacts. Begin with stationary scenarios and shadow observation; moving interaction requires the human-factors gate. Keep existing safety arrangements available and never induce fatigue, crime or an emergency.

Register baseline/current practice, fixed versus adaptive comparison, eligible cases, action ground truth, missing-outcome handling, budgets and stopping rules before looking at outcomes. Proposed 10-20 drivers is feasibility recruitment only; derive duration/sample/exposure from baseline variation and desired precision. Repeated trips are not independent people. Where safe and practical, counterbalance within-driver conditions; label observational comparisons and confounding honestly.

Measure independently observed appropriate-action delay, missed actionable scenarios, unnecessary escalations per registered active trip-hour including coverage gaps, burden, battery/data, cost per monitored trip and trust. Report unresolved outcomes and intervals; do not withhold essential assistance for a control. Immediately pause the affected mode on observed app-induced distraction, a critical privacy error or stale/false reassurance. A small pilot can validate feasibility, not rare-event harm reduction.

Incoming flow: Pilot eligibility reviewed.

Codus node: `pn_mvcq5q95_fb987d`

### Decide against frozen criteria · #38

Independent review compares H1/H2/H3 evidence to the preregistered contract and baseline. For H2 report the proportion with appropriate action by T_action and time-to-action including censored/unresolved cases; use driver-clustered uncertainty for comparison. Benefit must exceed the pre-agreed Delta_action with the specified confidence while burden/unnecessary escalations stay within B_attention/B_false and critical invariants hold. If the small sample cannot resolve this, conclude inconclusive rather than efficacy.

Outcomes: proceed with a supported limited promise; simplify to the fixed/stationary policy; revise platform/target scenario; or abandon the failing claim. H3 stays descriptive until independent outcomes and sufficient exposure support more. Preserve negative results and exact exclusions. No automatic hosting launch, spending or scope expansion follows this decision. The GitHub source handover below is already authorised for the finished implementation.

GitHub handover: the owner has authorised publishing this plan as open issues now in Bimbi-Dev/andes-hackathon and inviting Robertzu43 with write access. Keep completed implementation work in this same independent repository and publish it after its applicable checks pass. Check the actual repository owner, remote revision and invitation/access result. Record the repository URL and evidence; a pending invitation is not accepted access. Never publish credentials, participant data or SurcoCheck material. This GitHub handover does not authorise hosting deployment, participant recruitment, messaging-provider activation or new spending.

Incoming flow: Compare a bounded pilot.

Codus node: `pn_mvcq5qkj_0775cc`

### Repair and evidence limits · note

Maximum three repair attempts per failed axis, then record the concrete blocker. Recheck affected constraints on the same revision; never relax the acceptance threshold to make a failing result pass. Mocks cannot replace physical-device/provider evidence. Unknown is not success, and user/assistant opinion is not independent validation. A task is done only when its named evidence and independent acceptance criterion exist.

Entry in this section.

Codus node: `pn_mvcq5qw1_118b60`

<a id="insights"></a>
## Learn from shared data

### Gate voluntary data contribution · #39

This later phase requires the driver-value gate and enough consented observations; it is not needed to judge the MVP. Separate emergency operational sharing from optional research contribution and any later company/authority release. Define purpose, access, retention, withdrawal/export and precise-route handling for the initial country before collection.

Test with consent-state fixtures and participant teach-back: declining contribution must not remove core trip assistance. Verify deletion/withdrawal reaches derived datasets where applicable, and explain any irreversibly aggregated outputs. A privacy reviewer independently checks access and re-identification risks. Missing lawful/understood permission or an unresolved precise-location exposure blocks collection/release. No country-specific compliance claim is established by this plan.

Entry in this section.

Codus node: `pn_mvcq5fk5_cff5ef`

### Preserve analytical provenance · #40

Separate operational records from a minimised pseudonymised contribution stream with consent/version lineage. Preserve eligible opportunities, suppressions, observation/delivery/response times, policy, coverage, map confidence, self-report source and independent corroboration level. Precise trajectories and direct identifiers need restricted storage; pseudonymised is not anonymous.

Tools: versioned schema and SQL reconciliation against raw operational fixtures. Accept when another analyst can reconstruct each included/excluded event and trace consent and outcome labels. Avoid circular labels: a lost-contact alert cannot be the ground truth for crime/fatigue. Failure to distinguish source evidence or honour withdrawal blocks aggregation, not merely a chart refresh.

Incoming flow: Gate voluntary data contribution.

Codus node: `pn_mvcq5fw1_d523dd`

### Define honest rates and intervals · #41

H3 claim: data can describe observed check-in patterns by local hour and road context, within measured coverage. Use nonresponse per delivered prompt with explicit unknown-delivery counts; report suppression/eligibility separately. Distinguish delivery-to-response from perception latency. Define tiredness as self-report per observed trip/driver-hour with reporting opportunities, not as proven sleep.

Independently corroborated incidents may use trips or covered kilometres only when numerator/outcome linkage and exposure are adequate. SQL/Python analysis must show independent drivers, trips, coverage/missingness and uncertainty alongside every rate. A second analyst must reproduce a small hand-labelled fixture and then the analysis from raw events. If a denominator or outcome is absent, withhold the rate/ranking rather than fill gaps with inferred danger.

Incoming flow: Preserve analytical provenance.

Codus node: `pn_mvcq5g87_e40250`

### Test policy bias and privacy · #42

Explicit causal trap: curves/night hours may trigger more prompts or safer deferral; a resulting response pattern may reflect our policy, traffic or coverage rather than danger. Stratify by policy/delivery/coverage and route/time exposure; account for repeated drivers and selection into the app. Do not claim adjustment removes unmeasured confounding.

Hold out whole drivers/journeys or route-time blocks to match the intended claim; do not randomly split correlated points. A fixed-policy comparison or safer shadow analysis can test whether a hotspot disappears when prompting changes. Use driver-clustered uncertainty and sensitivity to missing outcomes. Set minimum independent-driver cells and privacy suppression before release, with rationale rather than an arbitrary “anonymous” count.

Accept: an independent analyst reproduces results and their sensitivity; unsupported or sparse cells remain unranked. If the signal disappears after policy/exposure accounting, report a measurement artefact and abandon the road-risk claim. No experiment may increase distracting prompts to obtain labels.

Incoming flow: Define honest rates and intervals.

Codus node: `pn_mvcq5gx4_dcdd0b`

### Gate claims before sharing · #43

Release tiers: (1) observed response/coverage patterns; (2) attributed tiredness reports; (3) separately corroborated incident associations. Each has source, denominator, uncertainty, coverage window, policy version and limits. Tier 1 cannot be titled “most dangerous hours/roads”; delays near a curve or station are not evidence of crime or sleep.

Before a stronger claim, compare independent outcomes whose provenance and time/location linkage were assessed without using our alert as the label. Preserve disagreements and missing outcomes. Independent methodology/privacy review must reproduce the result and approve its wording. Small/sparse data or absent ground truth keeps the report descriptive or withheld. Authorities/companies receive only specifically approved aggregates; individual evidence export is a separate driver choice.

Incoming flow: Test policy bias and privacy.

Codus node: `pn_mvcq5hbf_5a3c63`

### Verify a real reporting use · #44

Only after the prior evidence/privacy gates, identify one actual decision a consenting agency/company would make from the approved aggregate. Assess usefulness against its existing evidence and workflow; stated interest or a willingness-to-pay answer does not validate road safety or predictive accuracy.

Deliver methodology, data dictionary and a worked decision example reviewed by a domain user and an independent analyst. Accept only if the output supports that decision within its stated uncertainty and permissions. Otherwise stop institutional reporting and retain useful driver service. No employee fatigue/safety ranking, automatic discipline or expansion of collection to rescue a weak institutional proposition.

Incoming flow: Gate claims before sharing.

Codus node: `pn_mvcq5hqa_caef8a`
