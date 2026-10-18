# Complete Andes plan

Current local architecture decision: [ADR-002](architecture/ADR-002-aws-durable-dispatch.md), selected by Robert’s delegation, supersedes earlier implementation assumptions about global dispatch fencing, closure ordering and single-channel routing. The original issue text below remains a provenance snapshot; issue owners/blockers/evidence gates and remote issue states are not changed by the design decision.

All 63 original nodes are retained below. The 44 task nodes map to GitHub issues; the 19 actions/notes remain explicit flow, gates and context.

<a id="root"></a>
## Project flow

### ANDES · Team GOAT

Project: ANDES (hackathon). Team: GOAT. This project has its own workspace and GitHub repository, separate from SurcoCheck.

Product scope: independent freight truck drivers and owner-operators across Latin America, including Brazil, who typically own or operate one or two trucks (camiones/caminhões). The individual driver is the primary customer. Freight transport is the target use case, covering local and interurban haulage; a corporate fleet account or control centre is not required. The product is designed around the phone and trusted contacts the driver already has.

Core problems: robbery or attempted robbery during freight transportation, and fatigue or falling asleep while driving. ANDES aims to help drivers request support, keep trusted contacts informed and preserve useful security/fatigue evidence. Record phone and route observations, bounded check-ins, driving/rest context, attributed fatigue or sleepiness reports, and reported security incidents. Keep unknown, self-reported, suspected and independently corroborated events distinct.

Positioning: a direct-to-driver service for small owner-operators, with simple onboarding and individual control over sharing. The founder identifies a gap in products oriented toward large fleets. Whether current alternatives fail this segment, how common one/two-truck ownership is and what drivers will pay remain research questions; no market-share statistic or competitor capability is asserted.

Design for Spanish and Brazilian Portuguese, configurable country/locale, international phone numbers and local time zones. Additional language coverage must be stated explicitly. Validation may start with a small evidence-selected cohort and corridor in any Latin American country. Record the countries, languages and conditions actually tested; a local sample does not validate the whole region. Each enabled country/channel/language combination needs its own support evidence, with unsupported conditions shown honestly.

Critical scenarios: a freight driver requests help or reports a security incident; a driver reports tiredness and needs a safe rest/support action; or an agreed check-in/arrival is missed and the trusted contact cannot tell whether to act. Intended benefit: reduce avoidable delay to appropriate contact action without increasing driving distraction or alarm burden. Phone signal -> qualified observation/report -> bounded check-in or explicit help -> attributed/uncertain alert -> contact acknowledgement -> recorded action is the causal chain to test. Phone telemetry and missed replies alone do not establish sleep or robbery. Any later automatic detection or stronger safety claim requires independent validation; weapon detection is not an implemented capability.

Core journey: while stationary, a freight driver describes a haul by voice note or natural-language text, reviews and confirms the proposed trip, then starts phone-based live location sharing with selected accepted trusted contacts. Contacts follow current location while supported observations are available, with timestamp, accuracy and explicit stale/unavailable states. The trip continues through the existing rest, check-in, help, escalation, contact-action and arrival flows. Voice/text interpretation never activates a trip or grants access without driver confirmation.

Incoming flow: Entry/context.

### Validate the promise

Define the initial harm, inventory original evidence and challenge the three claims before choosing the MVP promise. Exit: traceable incident timelines, real-device/provider limits and a preregistered evidence contract; missing evidence remains a gate.

The target market is Latin America. Record the countries, languages, devices and routes represented by evidence; a local validation cohort must not become a Peru-only product requirement.

Validate the freight owner-operator problem directly: robbery/security concerns and fatigue/sleepiness during transport. Test the proposed gap against the drivers' actual tracking/contact tools, purchase decisions and setup constraints; a large-fleet comparison alone does not establish unmet demand.

Incoming flow: entry.

### Prepare a safe trip

Make the monitoring limits, driver choices and contact responsibilities understandable before departure. Gate the journey on observed comprehension and safe interaction, with a clear server registration and cancellation contract.

Support country and language selection for Latin American drivers and contacts. Verify localised comprehension, international phone entry and time-zone handling without a hard-coded Peruvian default.

The account is controlled by an individual freight driver with one or two trucks. Keep registration and trusted-circle setup usable without an enterprise fleet administrator or dispatcher.

Incoming flow: validate [Evidence passes].

### Track available signals

Capture only supported observations with provenance, freshness and missingness. An independent observer must be able to reproduce what the app knew without mistaking device telemetry for driver wellbeing.

Retain country, locale and time-zone provenance so route context and observed coverage remain interpretable across Latin America.

Capture freight-trip security and fatigue evidence explicitly, including reported rest/tiredness and reported incidents with their source and corroboration level. Generic location traces cannot substitute for these outcomes.

Incoming flow: prepare.

### Adapt safety check-ins

Test H1: bounded adaptive check-ins must add useful information without demanding attention at an unsafe time. Compare the simplest fixed policy and current contact practice before accepting added adaptation.

Keep fatigue/rest self-report and security/help reports as explicit states in freight scenarios. Do not infer either from a slow response or phone movement; capture incident detail later when safe.

Incoming flow: track.

### Escalate and resolve

Test H2: persist deadlines, qualify uncertainty and progress from delivery to human action. Gate each promised channel on observed receipts and contact behaviour, including ambiguous failures and unavailable recipients.

Enable each country/channel/language combination only with evidence for the actual driver and recipient destinations; do not infer regional delivery from one country test.

Route explicit freight security/help reports and fatigue/rest-support requests through the agreed trusted circle. A missing check-in remains an unknown-status event; it is not a confirmed robbery or sleep event.

Incoming flow: checkins.

### Verify and pilot

Use predefined scenarios, an independent reviewer and baseline comparisons. The five existing verification axes gate a bounded future pilot; pilot feasibility never establishes reduced crashes or robberies.

Choose a bounded cohort in any Latin American country and state its limits. Keep a country/channel/language support matrix; a successful local pilot does not establish region-wide efficacy or availability.

Incoming flow: escalate.

### Driver MVP decision

Read the evidence contract and independent review: proceed with the supported promise, simplify/revise it, or stop. Unknown evidence is not a pass. A small pilot can establish feasibility and measured response performance, not crash/robbery reduction. The shared-data branch starts only if driver value, appropriate consent and its separate evidence gate are met; failing the MVP gate freezes it.

GitHub handover: the owner has authorised publishing this plan as open issues now in Bimbi-Dev/andes-hackathon and inviting Robertzu43 with write access. Keep completed implementation work in this same independent repository and publish it after its applicable checks pass. Check the actual repository owner, remote revision and invitation/access result. Record the repository URL and evidence; a pending invitation is not accepted access. Never publish credentials, participant data or SurcoCheck material. This GitHub handover does not authorise hosting deployment, participant recruitment, messaging-provider activation or new spending.

Incoming flow: verify.

### Learn from shared data

Later conditional phase for H3. Separate operational observations, self-reports and independently corroborated outcomes; require exposure, missingness, policy-bias and privacy checks before any aggregate release.

Label results by country, language, route and measured exposure; any regional aggregate must disclose which populations and conditions are represented.

The later data purpose includes freight-security and fatigue/rest patterns by route and time. Distinguish reported events from corroborated incidents and retain exposure and uncertainty for both.

Incoming flow: candidate [Data gates pass].

### Evidence review complete

Record supported claims, rejected assumptions and unresolved questions. Latin America is the product scope. Enabling an additional country or language within it requires applicable evidence and an explicit support statement; it is not excluded from the product vision. Additional platforms and institutional reporting remain later decisions requiring their own evidence and authorisation. Preserve adverse results and the existing seven-section task structure.

Incoming flow: insights.

### GOAT project and delivery

Authorised now: publish this existing Codus plan as open GitHub issues in the separate private Bimbi-Dev/andes-hackathon repository, team GOAT, and invite Robertzu43 with write access. The scope is independent freight truck drivers/owner-operators across Latin America, including Brazil, typically with one or two trucks. Robbery during transport and fatigue/sleepiness are the core problems; the individual driver is the primary customer. The seven sections, 63 nodes and 44 task nodes are retained; the regional requirements are incorporated into existing tasks. Sebastian has authorised starting his assigned engineering work: the #8 evidence kit and preparatory #9 iPhone recorder/protocol are in progress. Android remains untested. Real participant interviews, provider activation, trip collection and live pilots have not started; tooling does not satisfy those evidence gates.

ANDES is separate from SurcoCheck, with independent code, configuration, data and delivery ownership. Before starting a section, satisfy its evidence gate. Missing or inconclusive evidence is not a pass. Use issue closure only for completed work supported by evidence. Invitation acceptance must be reported separately from sending the invitation. Hosting deployment, spending and live pilots remain separately scoped.

Incoming flow: Entry/context.

### Three claims to test

H1: a bounded check-in can obtain useful status without unsafe distraction. H2: escalation can get an appropriate trusted-contact action sooner than current arrangements under supported conditions. H3: contributed observations can describe response patterns; stronger fatigue/crime/road-risk claims need independent outcomes.

Heartbeat means an “I’m OK” check-in, not cardiac pulse. Device liveness, prompt delivery, driver response and wellbeing are different facts. An OK reply is time-specific self-report; a missing reply is unknown. A careful driver on a curve may respond slowly. More prompting on that curve can manufacture a misleading hotspot.

Robbery and fatigue are the product's motivating problems. Their measurement must distinguish an attributed report (for example tiredness, suspected threat or a reported attempted robbery), the app's observations and any independently corroborated outcome. A missing reply is never a substitute for an incident label.

Incoming flow: Entry/context.

<a id="validate"></a>
## Validate the promise

### Reconstruct freight trip incidents · #8

Claim: the initial cohort experiences avoidable delay between an unconfirmed trip status and useful contact action. Start from original driver/contact accounts and consented timestamps, not competitor marketing or founder summaries.

Smallest proposed collection after separate authorisation: five driver-contact pairs, each reconstructing one recent worrying trip and one ordinary trip using a critical-incident interview. Record what each person knew at each time, actions, decision cues, missed opportunities, and available GPS/message/call records; redact unrelated third parties. Five pairs are exploratory, not a prevalence or efficacy sample. Do not require a genuine emergency history to qualify.

Tools: recorded interview/transcript with consent and a spreadsheet timeline with source IDs, observed versus recalled timestamps, contradictions and uncertainty. Compare with their actual WhatsApp/call arrangements and include harmless late replies. Independent criterion: both participants review their own account; a reviewer outside implementation can trace the claimed intervention window to source records. Change/stop: if records show no actionable window, nobody available to act, or no unmet problem, revise the scenario before building. Output: cohort brief, evidence inventory and baseline timelines.

Recruitment eligibility, when authorised, is independent freight drivers/owner-operators from any Latin American country who typically own or operate one or two trucks. Record country, preferred language, truck count/driver role, freight journey type, route, connectivity and trusted-contact arrangement. Do not require Peru or a large-fleet employer. Select the exploratory cohort from accessible original evidence and report its coverage gaps; five pairs cannot establish regional demand. Preserve Spanish/Portuguese language needs in the handoff even if the first sample covers only one language.

Cover the two motivating problems in interviews without requiring a participant to have experienced both: robbery/attempted robbery or security concern during freight transport, and tiredness/sleepiness or a rest-related difficulty. Use ordinary freight trips as counterexamples. Record source, observed versus recalled time, road context, reported rest, action taken, outcome and any independently available corroboration; preserve missing evidence. Ask what existing GPS/fleet/contact tools they actually use, what setup/cost constraints matter and whether the proposed driver-controlled flow adds value. Do not infer prevalence or willingness to pay from the founder's description.

Entry in this section.


### Test phone capability limits · #9

Claim: the proposed observation/check-in flow works in explicitly supported phone states. Evidence required: physical-device traces for representative cohort Android and iPhone models, OS/browser versions and installed-PWA state; browser emulation is insufficient.

Method/tools: Chrome remote debugging or Safari Web Inspector, a separate timestamped observer log and server event logs. Test foreground, locked screen, background/navigation, permission denial/revocation, battery saver, offline/reconnect and phone shutdown. Check GPS freshness, motion permission, notification delivery and any audio/response mode separately; measure battery/data use against the same journey without the app. Do not assume SIM-number or battery APIs exist.

Accept: each promised state has reproducible device evidence, and every unavailable state is explicitly degraded/unsupported. No supported state may imply continuous monitoring after evidence becomes stale. Change: if the critical scenario needs continuous locked-screen capture the web app cannot establish, narrow the promise or record a later native-platform decision; do not add that build now. Outcome: capability matrix with raw logs, limits and repeatable cases.

Tie the capability matrix to the devices, carriers, connectivity and languages represented in the selected Latin American cohort. Device evidence from one setup is not country-wide coverage evidence; keep untested combinations explicit.

Qualify the recorder in the freight cab use context when actual testing is authorised: phone placement, navigation/calls, mounting vibration, charging and connectivity may affect observations. Do not treat motion or a quiet phone as evidence of sleep, assault or cargo theft. Start with the available iPhone; keep Android and other configurations untested until measured.

Test microphone capture and phone-to-contact location updates on physical devices, including navigation, locked screen, background, permission revocation and reconnect. Define and measure supported update cadence, end-to-end latency, stale threshold and battery cost before claiming live tracking. Continuous sharing throughout an active trip is the target experience, not an established browser capability; if locked/background tracking fails, record the platform gap and required platform decision in #12. A foreground-only demonstration does not satisfy continuous background tracking.

Incoming flow: Reconstruct freight trip incidents.


### Verify channel evidence · #10

Claim: opted-in contacts in each proposed launch country can receive the promised channels and respond. The product targets Latin America; assess actual driver and recipient destinations separately, including contacts with an international number. Use current official WhatsApp/SMS/voice documentation and later designated sandbox/test-recipient receipts; document country coverage, account eligibility, templates, consent, costs and callback meanings.

For colleague groups, verify official account eligibility and support for the actual existing-group use case. An API mention alone is not proof our account or group works. Tools: provider dashboard/sandbox, signed webhook logs and a separate recipient observation record. A mock establishes only internal logic.

Accept: every promised channel has traceable message/call IDs, observed recipient arrival and an explicit acknowledgement path. If blocked, preserve the requirement as conditional and plan opted-in individual delivery or stationary manual sharing; no unofficial automation. Freeze fallback order/deadlines only after observed timing and the incident window are known. No live provider activation or outbound contact is authorised by this planning update.

Deliver a country/channel/language matrix with supported, conditional, unavailable and untested states. Include Spanish and Brazilian Portuguese template/voice comprehension, international number formats, delivery evidence and dated provider terms. A working Peru account or sandbox must not be presented as proof of regional availability; keep unverified combinations conditional without removing those drivers from the product vision.

Incoming flow: Test phone capability limits.


### Set evidence and stop gates · #11

Create the decision contract before implementation or outcome inspection. Use a bounded STPA analysis of driver, phone/web app, server, provider and trusted contact: losses are added distraction, missed/late useful help, false alarm burden and inappropriate location disclosure. Model missing, early/late, excessive or stale prompts/escalation and inadequate human feedback. Draw one control diagram and a hazard-to-test table; do not turn this into a general certification exercise.

For H1, H2 and H3 record claim -> source evidence -> test -> independent acceptance criterion -> revise/stop result. Register the baseline and the units: delivered/eligible prompts, trip, covered driver-hour, contact action and independently labelled event. Choose T_action (latest useful action time), Delta_action (minimum worthwhile improvement), B_false (maximum tolerable unnecessary escalations per driver-hour) and B_attention (interaction limit). Numeric values are UNSET until reconstructed timelines, baseline variation, contact tolerance and an independent human-factors review justify them. Unset values block the pilot; they are not defaults to invent.

Operational burden uses all registered active trip-hours, including sensor/network gaps, with trip-end censoring defined in advance. Do not discard an outage from the denominator while counting the alert it caused. Road-segment rates use separately qualified location-covered exposure; never reuse that denominator for overall alert burden.

Zero-tolerance deterministic gates: no forced screen interaction to prevent an alarm while moving; no stale post-resolution escalation; no unsupported wellbeing assertion; no unauthorised route disclosure. Passing scripted cases proves those cases only. Accept the web-first MVP only with these gates and traceable capability limits. If core harm cannot be mitigated within them, simplify the policy or stop the promise.

Freeze the country, language, route and device conditions to which each acceptance threshold applies. Record what must be retested before enabling another combination; do not silently transfer local timings or tolerances to all Latin American drivers.

The hazard table must cover explicit help/security reports, fatigue/rest-support requests and uncertain lost contact during freight transport. Separate operational response performance from the eventual claims of reduced robbery or fatigue-related harm. Make route/cargo disclosure during a security event a specific privacy failure case.

Incoming flow: Verify channel evidence.


### Record evidence-led decisions · #12

Use the separate ANDES (hackathon) workspace for team GOAT; select stack and supervised queue after the capability/claim gate. Record which observation, deadline, contact action and consent state each component owns, and attach each architecture choice to a failure scenario. Do not use SurcoCheck as the project, repository or deployment target. No automatic reuse of its municipal code, configuration, data or the obsolete camera hypothesis; no assumed existing routes/files. The Andes repository is Bimbi-Dev/andes-hackathon; Robertzu43 is the authorised write collaborator.

Deliver a small architecture decision record, the check-in/escalation state machine and versioned event contracts. Server-owned timers plus a transactional outbox are required where browser loss must not discard agreed deadlines; external sends run through supervised jobs with reconciliation and observable status. Testability must include deterministic clock/event replay, raw evidence export and exact policy/revision provenance. Independent review must trace every safety constraint to an owner and test. If a constraint has no implementable owner, keep it unresolved before feature build.

Keep country, locale, message templates, channel eligibility and verified emergency guidance configurable. Support international phone identities and explicit time zones; do not hard-code Peru, a single dialling prefix, national document or plate format. Unknown or changed country/channel coverage must use the existing degraded/unavailable states rather than an unsupported safety promise. This extends the existing contracts, not the number of workstreams.

The product boundary is a driver-controlled account with one or two freight trucks; a corporate fleet tenant or dispatcher workflow is not a prerequisite. Extend the existing event contract with typed fatigue/rest and security reports, reporter/source and corroboration state. These are requirements for the existing architecture task, not a new fleet-management product.

Include voice/text trip intake and authorised live location sharing in the component and API contracts. Robert owns transcription/extraction integration, validated draft/confirmation contracts and location ingestion/read/update authorisation; Sebastian owns recording/text entry, review/correction, phone capture and contact-map UI. Treat audio, text and model output as untrusted input: bound size/duration and supported formats, validate extracted fields, resolve truck/contact references only within the acting driver’s permissions, and prevent instructions in input from granting access or executing actions. Define audio/transcript processing disclosure, restricted access and minimal retention/deletion; do not place raw recordings or contact-link secrets in logs. Choose the update transport after #9 evidence; the transport does not solve phone background capture.

Incoming flow: Set evidence and stop gates.


### Evidence available and missing · note

Available now: the user's original product description; the existing native plan and local spec; the user's clarification that Chofex's CEO only made a Samsara comparison, with no unmet-need evidence or pilot offer (Brain note 1842). The old freight-vision validation.json contains public/sample-video vehicle/dwell smoke tests, including a failed parking case; it does not validate phone-based check-ins or real drivers. Source: the separate freight-vision prototype validation.json, retained in the private research archive and not bundled with this repository.

Not supplied/collected for this mobile hypothesis: original driver/contact interviews, consented real journey traces, communication logs, phone lifecycle measurements, provider receipts, independent incident labels or baseline response/burden measures. Their absence is an evidence gap, not evidence that the hypothesis passes. The smallest acquisition exercise is in Reconstruct freight trip incidents; device and channel tasks specify their own missing measurements.

Primary references checked 17 October 2026: MIT STPA methods https://psas.scripts.mit.edu/home/books-and-handbooks/ ; attention/distraction https://www.nhtsa.gov/book/countermeasures-that-work/distracted-driving ; geolocation https://www.w3.org/TR/geolocation/ ; Web Push https://webkit.org/blog/12945/meet-web-push/ . These support methods/platform constraints, not this product's efficacy or country-specific compliance anywhere in Latin America. Previously reviewed device permission reference: https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent/requestPermission_static . Meta Groups documentation was rate-limited in the earlier review; account/existing-group capability remains unverified. No new customer research has been performed by upgrading this plan.

The founder's corrected brief identifies independent one/two-truck freight owner-operators, robbery during transport and fatigue/falling asleep as the problem focus. The claim that mainstream tools underserve this group is a research hypothesis; no customer sample, ownership prevalence statistic or competitor-gap finding is supplied by the correction.

Entry in this section.


<a id="prepare"></a>
## Prepare a safe trip

### Validate the mobile journey · #13

Map Home, Trucks, Trusted Contacts, Start Trip, Active Trip, Check-in, Alert Status, Contact Response, Trip Summary and Privacy. Use a low-bandwidth, localisable clickable flow with Spanish and Brazilian Portuguese variants, large targets, screen-reader labels and clear permission states. Include explicit country/language choice and local phone, date and time presentation; language must not be inferred solely from location. Setup takes place while stationary.

Evidence gate: observed task walkthroughs with representative drivers/contacts, screen recordings and teach-back of what “unknown”, last location and alert acknowledgement mean. Every critical task must be completed and limits explained without facilitator rescue; record all confusion before revision. A stationary walkthrough establishes comprehension, not driving safety. Driving interaction requires the separate human-factors gate. Remove typing and any requirement to look/tap while moving to prevent an alarm. A visually polished screen cannot close this task without the observation record.

Validate each enabled language with drivers and contacts who use it, including translated uncertainty and help messages. Preserve layout and accessibility with longer text. Any untested language remains labelled as such; a Spanish-only walkthrough cannot establish suitability for Brazil.

Use freight-driver terminology: Trucks / Camiones / Caminhões, freight trip, rest and trusted contacts. Show fatigue/rest and security/help reporting without requiring an incident description while moving; collect detailed context when stationary or through an authorised contact. The default flow must be usable by one owner-operator without a company dashboard.

Start Trip accepts a voice note or natural-language text while stationary. Show the transcript/proposed origin, destination, truck, departure, arrival date/time zone, planned stops and contacts; allow corrections and ask for missing or ambiguous details. Require explicit confirmation of the final trip and sharing recipients before activation. Test Spanish and Brazilian Portuguese, denied microphone permission, transcription failure and ambiguous names/times; typed/manual correction remains available. Show recording/processing/error states without claiming that a draft is an active trip.

Entry in this section.


### Verify driver and trucks · #14

Create driver-entered phone verification and one/two-truck profiles with a nickname and useful identification. Do not infer SIM number or identity from browser access. Include recovery, number change and shared-truck assignment; truck ownership alone never grants covert location access.

Acceptance evidence: designated test-account verification/recovery logs, expired/reused-code cases and cross-driver access tests. The acting driver's explicit trip selection must determine which contacts and truck are associated. A second tester must confirm number recycling or shared trucks cannot expose another driver's history. Unresolved identity/permission ambiguity blocks trip sharing.

Accept driver-entered international numbers with an explicit country selector and canonical international representation; test at least distinct Latin American numbering patterns including Brazil, plus number changes. Phone-number country, residence and trip country are separate facts. Keep truck identification flexible across countries; do not require a Peruvian document or plate pattern. No number-validation fixture proves provider delivery.

Represent the driver's relationship to each freight truck without creating a fleet-company account requirement. Truck count and role describe the target segment; they do not grant permission to track another driver.

Incoming flow: Validate the mobile journey.


### Validate the trusted circle · #15

Capture accepted/pending/rejected/revoked contacts, channel preferences, escalation order and per-trip sharing consent. No unconsented address-book upload. Response links are scoped, expiring and revocable.

Claim: a named contact is willing and able to take a useful action, not merely reachable. Walk through an unconfirmed-trip scenario and a “cannot assist” response using the contact's current arrangements as baseline. Record comprehension, availability and their chosen safe next action. Accept only if the role and handoff are understood and unavailability has an honest terminal state; acknowledgement is not assumed to mean help. If no contact can act, revise the promise before enrolling that trip. No automated emergency-service dispatch is included.

Store each contact's preferred language, phone-number country and verified reachable channels independently from the driver's country. Confirm mutual understanding of the localised message and agreed action; a foreign number does not imply nearby physical assistance.

Obtain per-trip consent for live location sharing with each selected accepted contact, with a clear duration and revocation control. Distinguish map-view permission from incident-response permission. A scoped contact link is a bearer credential: communicate forwarding risk, make it expiring/revocable, and prevent access to other trips or full historical routes by default. Revoking live sharing must not silently cancel agreed check-in deadlines; explain any resulting change to contact availability.

Incoming flow: Verify driver and trucks.


### Register the trip and limits · #16

Before departure select truck, destination/expected arrival, optional route, planned stops and accepted contacts. Explain the tested capability limits and policy; check permissions while stationary. Server acknowledgement must confirm durable trip and deadline registration before showing monitoring configured.

Test with dropped start responses, offline setup, denied sensors, unavailable channels, refresh and duplicate submit. Accept: the independent observer can reconcile the displayed state with one server trip and one valid deadline; an unknown registration never displays active coverage. A timed-check-in-only mode must name its limits, and lack of contact delivery capability must remain visible. Avoid an unqualified “protected” claim. Unregistered trips cannot be silently treated as covered.

Make departure/destination country context and arrival time zone explicit where relevant; display local times and retain unambiguous instants for server deadlines. Test different device/destination time zones and changed or unknown country coverage. Preserve the existing unsupported/degraded flow when the route or recipient combination lacks evidence, including cross-border trips; do not silently assume home-country coverage.

Associate each freight trip with the selected truck and driver, planned rest/check-in arrangement and agreed contacts. Use only the transport context needed for safety; cargo value, customer details and manifests are not required default inputs.

Implement voice-note transcription and natural-language text extraction into a driver-owned trip draft, followed by clarification, correction and explicit confirmation. Missing or ambiguous origin/destination, truck, contact or arrival date/time zone must not be silently invented; optional fields remain optional. Validate the confirmed draft against current truck/contact permissions and the supported sharing mode, then durably register the trip, grants and deadlines before acknowledging activation. Test equivalent voice/text descriptions, malformed or instruction-bearing model output, ambiguous “tomorrow at six”, revoked contacts, stale draft confirmation, failed transcription and repeated start requests. Neither a transcript nor an unconfirmed draft starts tracking, sends notifications or schedules escalation.

Incoming flow: Validate the trusted circle.


### Prove pause and arrival rules · #17

Model planned rest, extension, cancellation and arrival with explicit server acknowledgement. Pause/extension has a bounded new deadline; arrival cancels future check-ins and escalation jobs. Already sent alerts receive a scoped resolution update where possible. Contact acknowledgement cannot declare the driver safe.

Acceptance evidence: deterministic event replay of arrival versus worker dispatch, delayed offline closure, repeated taps, restart and expired pause. Zero obsolete escalation may be initiated after committed resolution; if the provider already accepted a send, record that fact and reconcile rather than promise recall. The same final state must appear on Active Trip, Contact Response and Summary. Preserve unresolved contact/driver disagreement and retest the failing race.

Record planned and reported actual rest separately, including the driver's attributed tiredness/sleepiness report when supplied. A parked truck or a break timer does not establish that the driver slept or recovered.

On committed arrival or cancellation, end live location publication and contact-map access for that trip, including existing update subscriptions; retain summary/incident access only under its separate scope. Test delayed location uploads, already-open contact views and reconnect after closure. Location already viewed or copied cannot be recalled. Rest or extension follows the explicitly confirmed sharing agreement rather than silently changing recipients or visibility.

Incoming flow: Register the trip and limits.


<a id="track"></a>
## Track available signals

### Define auditable trip events · #18

Schema: event/trip/session ID, sequence, source time, server receipt time, timezone, revision/policy version, permission/visibility, GPS accuracy/age and provenance. Represent device liveness, scheduled prompt, accepted send, observed delivery, response, reported wellbeing and independent incident outcome separately; unknown stays explicit.

Tooling: versioned data dictionary, labelled JSON fixtures and SQL reconciliation queries. Observer ground truth is stored separately from model/rule outputs and preserves disagreement; do not let an alert label its own “incident”. Acceptance: another engineer reproduces the trip timeline and denominators from raw events, including duplicate, out-of-order and clock-skew cases. If source/receipt times cannot be reconciled, mark uncertain latency instead of inventing precision.

Represent country context, user/contact locale and the provenance or uncertainty of each. Store event instants consistently with an explicit offset and IANA time-zone identifier for local-hour derivation where known. Test offset changes, device-zone mismatch and unknown country/zone without moving an already agreed deadline. Do not infer trip country from the phone prefix.

Add explicit event categories for fatigue/sleepiness self-report, planned/started/ended rest, security concern, reported attempted robbery, reported robbery/theft, help request and independently corroborated outcome. Preserve reporter role/source, event time and uncertainty, source/receipt times, truck/trip reference, location accuracy or unknown context, reported action and verification status. Reporter information and evidence references remain access-controlled. Test that no telemetry or no-response rule silently upgrades a report to confirmed sleep/crime; the schema must retain contradictory accounts.

Version the trip-draft/confirmation and location-sharing contracts: input modality, confirmed fields/revision, grant recipient/scope/expiry/revocation, and location sample ID/sequence, observed/received times, coordinates and accuracy. Separate proposed fields from confirmed values. Preserve location provenance without logging raw audio, transcripts, bearer links or unnecessary precise coordinates. Test duplicate/reordered samples and permission changes without treating a location update as a driver wellbeing response.

Entry in this section.


### Qualify phone observations · #19

Capture permission-gated GPS/motion only in the tested device matrix. Label quality, route progress and candidate motion changes; phone drops, potholes, handling and passenger movement remain confounders, not confirmed crashes/assault/sleep.

Use safe stationary handling and controlled recordings with separate observer timestamps to test these confounders. Compare battery/data consumption with a matched no-app session. Accept only observations whose provenance, freshness and resource cost fit the preregistered capability budget; unsupported raw streams stay unavailable. Remove a motion rule that adds false concern without independently observable benefit. Do not add computer vision or medical sensing to repair the hypothesis.

During an active, confirmed trip, collect and send location updates only with the driver’s permission and in measured supported phone states. Expose capture/upload failure and stop capture on trip closure or permission withdrawal. Qualify cadence, freshness and battery/data use with #9; a background connection or push notification alone does not prove fresh GPS capture.

Incoming flow: Define auditable trip events.


### Qualify road and time context · #20

Attach local hour, elapsed trip time, time since reported break, road segment and mapped curves/rest stops to observations. Preserve map source/version and map-match confidence; cached/batched provider enrichment should not block urgent deadlines.

Compare representative traces with independently reviewed locations, including parallel roads, poor GPS and passing a petrol station without stopping. Accept only matches supported by position uncertainty; otherwise retain unknown context. A nearby station cannot establish a safe stop, and a curve cannot justify pressuring a driver to respond. Geometry/time may inform conservative deferral; they do not establish sleep or crime risk. Reject context rules whose benefit depends on precise map knowledge the phone cannot supply.

Qualify map coverage per country and route, and derive local hour from the observed location/time-zone evidence rather than a fixed Peru offset. Test cross-zone or cross-border context and unknown mappings; unsupported enrichment must not fabricate road risk or block the existing deadline path.

Use freight route/stop context where available, and keep a mapped rest stop separate from an observed stop and a driver-reported rest. Record time since a reported break without treating it as a medical diagnosis or proving continuous driving from sparse GPS.

Incoming flow: Qualify phone observations.


### Make coverage gaps explicit · #21

Buffer bounded telemetry, retain observation time and reconcile after reconnect without animating an old point as live. Server deadlines survive page loss but observe missing contact, not its cause. Battery death, stolen/unavailable phone, app suspension and network loss are indistinguishable unless independent evidence separates them.

Fault cases: airplane mode, screen lock/background, browser kill, shutdown, delayed batch and reordered upload. The external observer records when availability changed. Accept: no fresh location/wellbeing claim inside an unobserved interval; last confirmed position/time and uncertainty remain visible, and agreed lost-contact action follows server deadlines. Do not “fix” missing coverage by escalating indefinitely or inventing a cause.

Implement authorised ingestion, current-location reads and update delivery for accepted per-trip contacts. Validate sample identity, coordinate/accuracy bounds, timestamps and ordering; reject cross-driver/trip writes and prevent delayed samples from replacing newer positions. Recheck grants for reads, reconnects and delivery over existing subscriptions so expiry, revocation or trip closure prevents further server disclosure. On reconnect obtain an authorised current snapshot and preserve observation age; never animate buffered points as current movement. Test two drivers/two trips, revoked/expired links, open subscriptions at revocation, duplicate/out-of-order uploads and prolonged outages. Define bounded buffering and measured freshness/latency limits in #12/#18; server check-in deadlines remain independent of location delivery.

Incoming flow: Qualify road and time context.


### Verify monitoring-state truth · #22

Active Trip and Contact Response separately show last driver response, last usable location, server deadline and notification state. No browser timer or silent push is the sole owner of an agreed contact deadline.

Compare UI state, device observer log and server event trace through suspension, permissions loss, restart and reconnection. A driver/contact must correctly explain what is known and unknown in a walkthrough. Accept zero false live-monitoring assertions in required fixtures. Any confusion that could delay help or create false reassurance reopens the capability/UX gate; activity indicators alone do not prove safety.

Provide a trusted-contact live map showing the latest authorised position, observed time/age, accuracy, sharing state and current/stale/unavailable status. Keep location freshness separate from last driver response and alert/action status. Test updates between two physical devices, dropped updates, stale thresholds, reconnect and access revocation; the map must age into a stale state even when no new message arrives. No interpolation or “live” badge may imply an unobserved position.

Incoming flow: Make coverage gaps explicit.


<a id="checkins"></a>
## Adapt safety check-ins

### Specify a falsifiable policy · #23

H1 claim: a bounded policy can obtain useful driver status at acceptable attention cost. Baselines are the cohort's existing contact arrangement and a simple fixed safe check-in schedule. Start with the simplest policy; add context only if a prespecified comparison supports it.

Use a state/rule table with policy version, eligible opportunity, quiet/defer reason, maximum reminders, grace deadline and fallback. Inputs may include trip duration, reported break, local hour, road uncertainty and recent responses, but a missed reply is unknown and an OK reply is time-specific self-report. Define no-response/delivery-unknown/planned-pause separately.

Evidence: incident timelines, device limits and the STPA hazard table. Accept when every action has a safe timing rationale and traceable test; freeze numeric cadence/bounds before evaluation using the evidence contract. Change/stop if the policy needs touch/visual attention during demanding driving, continuously increases prompts, or cannot outperform a simpler safe arrangement. An opaque risk score is outside this MVP.

Entry in this section.


### Test safe check-in interaction · #24

Offer OK, rest and help only through verified interaction modes. Ordinary visual/manual prompts are deferred while moving; uncertain road context defaults to conservative handling. A driver must never touch/look at the phone merely to prevent an alarm. Audio/hands-free is a candidate to validate, not a presumption of safety.

Method: stationary usability first, then simulator or appropriately supervised closed-course assessment by an independent human-factors reviewer before any moving interaction. Compare eyes-off-road, task errors, interaction time and driving-performance indicators with the baseline using prespecified B_attention. Self-reported ease alone does not pass.

Acceptance: all mandatory suppression cases pass and the assessment stays within the justified attention limit. If such testing is unavailable or fails, retain stationary/planned-stop responses and server lost-contact handling. Never test by inducing fatigue or an actual roadside emergency.

Incoming flow: Specify a falsifiable policy.


### Separate delivery from response · #25

Store scheduled, dispatched, provider-accepted, available delivery/observation, client response and server-received timestamps separately with clock uncertainty. Provider delivery does not prove the person perceived a prompt. Report delivery-to-response only as that operational interval; claim perception-to-response only if independently observed.

Keep missing delivery, suppressed opportunities and unanswered delivered prompts explicit and censored where appropriate. Retain eligible opportunities, local hour/segment, rule version and deferral reason so more frequent prompts do not manufacture risk. Test delayed networks, phone idle, duplicate responses and impossible clock order in labelled fixtures. Accept when a second analyst reproduces the intervals and denominators from raw events. Reject any driver score that conflates network or safe deferral time with tiredness.

Incoming flow: Test safe check-in interaction.


### Test adaptive follow-up rules · #26

Replay OK, tired self-report, explicit help, unanswered delivery, delivery unknown and planned rest as separate states. OK returns to the agreed bounded cadence; tiredness offers a safe stopping option and an authorised contact update; explicit help takes the urgent path. A missed check-in follows bounded grace then an uncertain lost-contact alert, not a robbery diagnosis.

Counterexamples: a careful driver ignores a curve prompt; a message arrives after arrival; phone stolen/offline; a passenger replies; a stale OK arrives after a newer help request. Accept: unsafe opportunities are deferred, late events cannot erase current help state, and no response grants indefinite reassurance. Compare added adaptation against the fixed safe policy on held-out scenarios. If it adds burden or only reclassifies noise, keep the simpler policy and record the rejected rule.

Treat a security report/SOS as a request for help with attributed or uncertain facts, not a request for the driver to gather proof. For fatigue, record the report and proposed rest/contact action without requiring continued interaction while driving. Distinguish reported sleepiness from a later independently documented sleep-related event.

Incoming flow: Separate delivery from response.


### Prove deadline and race handling · #27

Persist trip state/deadlines before supervised scheduling; apply per-trip version checks and idempotent event handling. Server expiry may trigger a pre-agreed “unable to confirm status” alert with last-seen age even when the browser disappears. It cannot establish what happened to the driver.

Tools: fake clock/event replay, worker restart, delayed callbacks and independent expected-transition fixtures. Exercise arrival versus expiry, help versus late OK, duplicate jobs, long outage and extension versus queued send. Accept zero stale dispatch or missed required transition in the defined suite, with measured scheduler lag within the contract. Any ambiguous send is reconciled as unknown until evidence resolves it. Failures reopen this gate rather than being hidden by retry counts.

Incoming flow: Test adaptive follow-up rules.


### Compare benefit and burden · #28

Use the same independently labelled safe scenarios for current practice, fixed policy and adaptive policy; counterbalance order in stationary/simulator sessions. Define useful status as information that changes an appropriate contact decision, not clicks. Later pilot observations are a separate evidence tier.

SQL/Python measures: useful status per eligible opportunity, prompts and unnecessary escalation per registered active trip-hour including coverage gaps, unanswered delivered prompts, B_attention measures and missed actionable situations. Keep driver/route/time clusters separate; tune on development scenarios and hold out whole drivers or journeys for evaluation. Preserve failures and confidence intervals.

Accept adaptation only if it meets the preregistered benefit/attention limits without exceeding B_false compared with the simpler policy. Small or inconsistent evidence is inconclusive, not a reason to tune on the holdout. No improvement means remove adaptation; observed distraction means stop moving interaction. These are gates within the existing task, not extra product features.

Incoming flow: Prove deadline and race handling.


<a id="escalate"></a>
## Escalate and resolve

### Define action and uncertainty · #29

H2 claim: appropriate contact action occurs sooner than under current arrangements. State machine: active -> check-in due -> bounded grace -> lost-contact escalation -> contact acknowledged/action pending -> resolved; explicit SOS has its own urgent route. Also represent unable-to-deliver and no-contact-available without declaring success.

Define useful action from the incident timeline before testing: for example a contact attempts direct communication and follows the agreed next step, or arranges appropriate assistance. A delivered message, answered call or clicked acknowledgement is not help. Preserve who reported what and when; driver confirmation is separate.

Accept: independent scenario labels map every transition to an appropriate action and uncertainty statement. No response must never become “robbery confirmed”. If nobody can reasonably act within T_action, narrow the service promise; provider delivery alone cannot rescue it.

Represent the reason for escalation separately from delivery and action state: explicit security/help report, fatigue/rest-support request or unconfirmed trip status. Alert wording must preserve who reported the problem and whether it has been corroborated.

Entry in this section.


### Prove durable notification jobs · #30

Use the selected stack's supervised queue, durable deadline scheduler and transactional outbox. Handlers atomically persist state/outbox, return promptly and expose status; workers perform external sends. Health checks expose stuck timers/jobs. Reliability, external side effects and cost justify jobs rather than request-bound sends.

Evidence: crash/restart and duplicate-dispatch traces tied to trip/incident/version/recipient/channel keys. Test failure before/after DB commit and provider acceptance. Accept: persisted work survives worker loss; obsolete work is cancelled; ambiguous acceptance remains observable and reconciled. Local deduplication cannot prove exactly-once upstream delivery. Do not choose an infrastructure stack until architecture decisions exist.

Incoming flow: Define action and uncertainty.


### Qualify contact notifications · #31

Send incident/stage/recipient/channel attempts with the observed status, last location and age, driver/truck reference and scoped response link. Use verified WhatsApp one-to-one templates, SMS fallback and voice according to a pre-agreed priority/deadline policy. Payload minimisation and contact opt-in apply to every route.

Evidence: sandbox/authorised-recipient logs plus recipient screenshots or observation, with IDs and timestamps. Test unavailable channels, expired links, wrong/revoked contacts and language comprehension. Accept: recipients understand what is uncertain and what action is requested; sending fits T_action and never discloses a full route unnecessarily. Unproven channels remain disabled/conditional. This plan edit sends nothing.

Choose verified templates and voice content using the recipient's preferred language and the country/channel support matrix. Test Spanish and Brazilian Portuguese, international recipients and unsupported destinations. A channel proven in one country must remain conditional elsewhere until its delivery and comprehension checks pass.

Include the freight truck reference and minimum useful incident context; keep reported robbery/attempt/fatigue wording attributed. Do not broadcast cargo details, a full route or unnecessary evidence attachments to contacts or colleague groups.

Incoming flow: Prove durable notification jobs.


### Separate receipt from action · #32

Authenticate provider callbacks and record available queued/accepted/delivered/failed/answered states with provider IDs. Keep these separate from explicit contact acknowledgement, attempted action, assistance arranged and driver-confirmed status.

Reconcile callbacks against an independent recipient/observer timeline, including voicemail, delivered-but-unread, duplicate and out-of-order callbacks, and a contact who acknowledges then cannot help. Accept zero conflation of delivery/answer with useful action; late provider updates cannot regress a resolved incident. Unknown or unverifiable action remains labelled as such. Measure both acknowledgement and action latency rather than reporting whichever looks better.

Incoming flow: Qualify contact notifications.


### Bound retries and reconciliation · #33

Set bounded retries/backoff and fallback deadlines within the evidence contract. Honour provider limits; permanent errors stop. Use upstream idempotency only where verified. After an ambiguous timeout, reconcile provider IDs/status before any retry that might duplicate a warning.

Fault-inject acceptance followed by timeout, duplicate callbacks, queue restart, exhausted recipients and arrival during retry. Accept: every external attempt has a reason and final known/unknown state, and no new obsolete send starts after committed resolution. If upstream status cannot be resolved before T_action, apply the documented alternative channel with uncertainty and account for possible duplication; do not silently mark failure/success. Stop retry storms and report unavailability when all routes are exhausted.

Incoming flow: Separate receipt from action.


### Gate colleague-group delivery · #34

Keep colleague-group notification conditional on current official-provider eligibility and actual target-group support. If unavailable, retain opted-in individual colleagues and stationary manual sharing by a driver/contact. No unofficial personal-account automation.

Test scoped expiring links, revoked members, minimal payload and one clear response owner; group membership is not permission for continuous history. Independent walkthrough evidence must show that sharing does not leave everyone assuming somebody else will act. If there is no confirmed responder, status stays action pending. Group support cannot block a useful one-to-one MVP or be claimed from documentation alone.

Incoming flow: Bound retries and reconciliation.


### Verify useful contact action · #35

Contact view distinguishes “I’m contacting them”, “Help arranged”, “Cannot assist” and recorded resolution. Name the acting contact, avoid conflicting ownership, and hand off inability explicitly. Send scoped resolution updates only to already-alerted authorised recipients; preserve the event timeline.

Acceptance evidence: independently observed scenario outcome and participant account, not just button clicks. Test unavailable first contact, conflicting reports, accidental acknowledgement and driver offline after help is arranged. Measure time to the predefined useful action and unresolved cases. A contact report is attributed self-report until corroborated. Emergency guidance must be verified for the trip location and shown in a language the recipient understands, with source/date and an explicit unknown-location fallback; never default every country to a Peruvian emergency number; automated authority dispatch or a rescue guarantee is outside the initial promise.

Incoming flow: Gate colleague-group delivery.


### Test channels against ground truth · #36

Use designated test recipients and real provider sandbox evidence where available. Prelabel the expected result for WhatsApp failure/SMS fallback, unanswered voice/voicemail, explicit acknowledgement, opt-out, all contacts unavailable, ambiguous acceptance, duplicate callback, worker restart and cancellation races. No real emergency is induced.

Tools: provider IDs/receipts, signed webhook log, fake clock for server timing and an independent contact observer. Acceptance: all critical state/privacy invariants hold, each promised route has actual delivery evidence, and action outcomes are reported separately. Capture cost and time by channel; no mock substitutes for physical delivery. Unsupported modes are excluded, failures reopened, and timing beyond T_action requires policy/channel revision.

Execute the applicable cases for each country/channel/language combination proposed for enablement, including different driver/recipient countries. Record the tested carrier/provider/account conditions and exclude extrapolation from a single-country success.

Incoming flow: Verify useful contact action.


<a id="verify"></a>
## Verify and pilot

### Run preregistered scenarios · action

Future verification only, after the evidence contract is fixed. Use synthetic/consented records and designated recipients. A reviewer outside implementation prepares expected outcomes without seeing rule outputs. Required scenarios: normal arrival, harmless ignored prompt on a curve, planned rest, delayed delivery, no signal/phone shutdown, explicit SOS, unavailable contacts, duplicate/ambiguous send and late response after resolution.

Run current practice and proposed policy on matched safe scenarios; retain development/holdout separation. Save revision, configuration, device versions, observer labels, source/receipt clock uncertainty and every failure. A scenario matrix maps each H1/H2/H3 constraint to an existing verification axis. No real emergency, deliberately tired driving or external contact is authorised by this plan edit.

Include safe synthetic or consented freight scenarios for an explicit security report, a reported attempted robbery, a fatigue/rest request, ordinary late delivery, a planned freight stop and contradictory incident accounts. Prove reporting, provenance and response handling; no test induces robbery or drowsy driving.

Add end-to-end voice/text draft → correction → confirmation → durable start → authorised contact map → check-in/help → arrival scenarios. Include transcription failure, ambiguous arrival, forged extracted contact references, duplicate start, stale/out-of-order locations, two-trip isolation, revoked access on an open map and closure during reconnect. Use synthetic or specifically consented inputs. Verify phone-to-contact latency and capture limits separately from deterministic backend fixtures; report unsupported background modes explicitly.

Entry in this section.


### Attention and UX pass? · action

Use browser_navigate/screenshot/click/fill plus accessibility checks at 390x844, 360x800 and desktop. Verify all screens and permission/degraded states, with console/network evidence. Physical-device and observed-comprehension records supplement screenshots.

Pass requires no forced manual/visual response while moving and a successful independent human-factors assessment for any proposed moving interaction against B_attention. Audio alone is not a pass. Where assessment is missing, only stationary-response mode can be eligible. A critical misunderstanding or increased attention burden takes the No branch; preserve the failing observation and revise the interaction rather than relaxing the gate.

Incoming flow: Run preregistered scenarios; Fix the mobile journey [Retest].


### Fix the mobile journey · action

Repair layout, accessibility or unsafe interaction in the failing screens, then rerun the same mobile scenarios. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Attention and UX pass? [No].


### Trip state and meaning pass? · action

Replay start/unknown registration, rest/extension, arrival, cancellation, late OK, explicit SOS and contact acknowledgement. Inspect Home, Trucks, Contacts, Active Trip, Check-in, Alert Status, Contact Response, Summary and Privacy for shared-state regressions.

Independent expected transitions must match UI/server events through duplicate submit, concurrent actions, offline closure and cross-trip isolation. Pass requires no stale alert initiation after resolved state, no acknowledgement mistaken for driver safety and no erased help request from an older OK. Unknown state remains explicit. Any critical mismatch follows the No repair branch.

Incoming flow: Attention and UX pass? [Yes]; Fix trip state transitions [Retest].


### Fix trip state transitions · action

Repair the failing state transition or access boundary, then rerun the lifecycle scenarios and affected screens. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Trip state and meaning pass? [No].


### Delivery and action pass? · action

Verify actual WhatsApp/SMS/voice sandbox or designated-recipient side effects, signed callbacks, transient failure, ambiguous acceptance, idempotency, opt-out and cancellation. Compare provider receipts with independent recipient observations; group delivery passes only with verified official eligibility and target-group support.

Pass requires separate records for delivered, acknowledged and useful action, plus honest all-contacts-unavailable and channel-exhausted states. Required deterministic invariants have zero violations; observed timing must fit the frozen T_action. A mock receipt or “answered” voicemail cannot pass contact action. A failure or unsupported promised channel takes the No branch to repair or narrow the promise.

Incoming flow: Trip state and meaning pass? [Yes]; Fix dispatch or reconciliation [Retest].


### Fix dispatch or reconciliation · action

Repair the queue/provider/callback handling or remove an unsupported channel promise; rerun the same delivery and retry cases. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Delivery and action pass? [No].


### Coverage failures stay honest? · action

Inspect browser_console/network, device observer records and scheduler/worker logs through screen lock, background navigation, browser kill, phone shutdown, permission revoke, battery saver, GPS drift, phone handling, clock skew and prolonged outage.

Pass requires timestamp-correct degraded/unknown displays, server deadline recovery and no invented cause for lost phone contact. Check actual battery/data and scheduler lag against the frozen budgets. Any unsupported “live/safe” assertion or missed required transition fails regardless of happy-path success. Unavailable physical-device evidence means unsupported, not passed.

Incoming flow: Delivery and action pass? [Yes]; Fix degraded operation [Retest].


### Fix degraded operation · action

Repair expiry, buffering, freshness or capability handling, then repeat the failed physical-device and server-failure cases. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Coverage failures stay honest? [No].


### Evidence and access pass? · action

Test expired/revoked links, cross-user access, opt-out/deletion, payload scope and aggregate suppression. A second analyst recalculates denominators/intervals from labelled fixtures, checks policy-induced hotspots and verifies that driver-hour exposure is not fabricated during missing coverage.

An independent reviewer must trace every outward claim to evidence and distinguish feasibility, association and safety outcome. Pass requires zero critical access violations in the suite and no unsupported sleep/robbery/danger label. Later aggregate outputs may remain deferred without blocking the driver MVP, but operational consent and event provenance must pass. Preserve negative findings and follow the No branch on any critical failure.

Incoming flow: Coverage failures stay honest? [Yes]; Fix access or measurements [Retest].


### Fix access or measurements · action

Repair permissions, data minimisation or analytic definitions, then rerun the specific privacy/measurement checks. Retry only this failed axis; maximum three repair attempts before recording the blocker. This is a conditional repair, not permission to launch. Preserve the original failed evidence and threshold. Missing evidence remains unresolved; remove an unsupported promise or obtain the specified evidence rather than marking the gate passed.

Incoming flow: Evidence and access pass? [No].


### Pilot eligibility reviewed · action

All applicable axes pass on the same revision with source evidence and an independent reviewer disposition. Freeze the protocol, threshold values/rationale, supported devices/modes and unresolved exclusions before a pilot. Log the verification result only after tests actually run; current nodes remain todo.

An untested promised mode, unset T_action/Delta_action/B_false/B_attention or unresolved critical hazard blocks live pilot eligibility. Verified feasibility is not evidence of reduced crashes or robberies. This state neither deploys nor authorises participant recruitment.

Incoming flow: Evidence and access pass? [Yes].


### Compare a bounded pilot · #37

Future execution after separate authorisation only. Choose a bounded cohort of independent freight owner-operators with one or two trucks and an evidence-selected corridor in any Latin American country, with accepted contacts. The product remains region-wide; the pilot records the specific country, language, route, device and provider combinations it tests. Begin with stationary scenarios and shadow observation; moving interaction requires the human-factors gate. Keep existing safety arrangements available and never induce fatigue, crime or an emergency.

Register baseline/current practice, fixed versus adaptive comparison, eligible cases, action ground truth, missing-outcome handling, budgets and stopping rules before looking at outcomes. Proposed 10-20 drivers is feasibility recruitment only; derive duration/sample/exposure from baseline variation and desired precision. Repeated trips are not independent people. Where safe and practical, counterbalance within-driver conditions; label observational comparisons and confounding honestly.

Measure independently observed appropriate-action delay, missed actionable scenarios, unnecessary escalations per registered active trip-hour including coverage gaps, burden, battery/data, cost per monitored trip and trust. Report unresolved outcomes and intervals; do not withhold essential assistance for a control. Immediately pause the affected mode on observed app-induced distraction, a critical privacy error or stale/false reassurance. A small pilot can validate feasibility, not rare-event harm reduction.

Do not inflate recruitment merely to claim regional coverage. Report unrepresented countries/languages and require the relevant capability, channel, comprehension and permission checks before enabling them. A local feasibility result is not evidence of benefit for all Latin American drivers.

Incoming flow: Pilot eligibility reviewed.


### Decide against frozen criteria · #38

Independent review compares H1/H2/H3 evidence to the preregistered contract and baseline. For H2 report the proportion with appropriate action by T_action and time-to-action including censored/unresolved cases; use driver-clustered uncertainty for comparison. Benefit must exceed the pre-agreed Delta_action with the specified confidence while burden/unnecessary escalations stay within B_attention/B_false and critical invariants hold. If the small sample cannot resolve this, conclude inconclusive rather than efficacy.

Outcomes: proceed with a supported limited promise; simplify to the fixed/stationary policy; revise platform/target scenario; or abandon the failing claim. H3 stays descriptive until independent outcomes and sufficient exposure support more. Preserve negative results and exact exclusions. No automatic hosting launch, spending or scope expansion follows this decision. The GitHub source handover below is already authorised for the finished implementation.

GitHub handover: the owner has authorised publishing this plan as open issues now in Bimbi-Dev/andes-hackathon and inviting Robertzu43 with write access. Keep completed implementation work in this same independent repository and publish it after its applicable checks pass. Check the actual repository owner, remote revision and invitation/access result. Record the repository URL and evidence; a pending invitation is not accepted access. Never publish credentials, participant data or SurcoCheck material. This GitHub handover does not authorise hosting deployment, participant recruitment, messaging-provider activation or new spending.

Record proceed/revise/stop or inconclusive by tested country/channel/language combination, with explicit unsupported conditions. Preserve the Latin American product scope while separating it from the narrower availability and benefit claims established by evidence.

Incoming flow: Compare a bounded pilot.


### Repair and evidence limits · note

Maximum three repair attempts per failed axis, then record the concrete blocker. Recheck affected constraints on the same revision; never relax the acceptance threshold to make a failing result pass. Mocks cannot replace physical-device/provider evidence. Unknown is not success, and user/assistant opinion is not independent validation. A task is done only when its named evidence and independent acceptance criterion exist.

Entry in this section.


<a id="insights"></a>
## Learn from shared data

### Gate voluntary data contribution · #39

This later phase requires the driver-value gate and enough consented observations; it is not needed to judge the MVP. Separate emergency operational sharing from optional research contribution and any later company/authority release. Define purpose, access, retention, withdrawal/export and precise-route handling for each country where collection is proposed, including relevant data-hosting and transfer arrangements. Review applicable country requirements before enabling collection; do not treat one country's permission as region-wide permission. Provide comprehensible Spanish/Brazilian Portuguese consent for the enabled audience.

Test with consent-state fixtures and participant teach-back: declining contribution must not remove core trip assistance. Verify deletion/withdrawal reaches derived datasets where applicable, and explain any irreversibly aggregated outputs. A privacy reviewer independently checks access and re-identification risks. Missing lawful/understood permission or an unresolved precise-location exposure blocks collection/release. No country-specific compliance claim is established by this plan.

Explain optional reuse of freight security reports and fatigue/rest reports, including who may receive aggregates. Operational help-sharing remains separate from company/authority research access; sensitive route and cargo context must not become a default export.

Entry in this section.


### Preserve analytical provenance · #40

Separate operational records from a minimised pseudonymised contribution stream with consent/version lineage. Preserve eligible opportunities, suppressions, observation/delivery/response times, policy, coverage, map confidence, self-report source and independent corroboration level. Precise trajectories and direct identifiers need restricted storage; pseudonymised is not anonymous.

Tools: versioned schema and SQL reconciliation against raw operational fixtures. Accept when another analyst can reconstruct each included/excluded event and trace consent and outcome labels. Avoid circular labels: a lost-contact alert cannot be the ground truth for crime/fatigue. Failure to distinguish source evidence or honour withdrawal blocks aggregation, not merely a chart refresh.

Retain country, language, route coverage and source time-zone lineage with consent provenance. Keep unknown geography explicit; regional pooling must not erase which population supplied the observations.

Keep separate, source-linked records for fatigue/sleepiness reports, reported rest, security concerns, reported attempted/completed robbery and corroborated outcomes. Retain their observation windows, eligible reporting opportunities, source and verification status so the data can answer freight-security and fatigue questions without treating alerts as ground truth.

Incoming flow: Gate voluntary data contribution.


### Define honest rates and intervals · #41

H3 claim: data can describe observed check-in patterns by local hour and road context, within measured coverage. Use nonresponse per delivered prompt with explicit unknown-delivery counts; report suppression/eligibility separately. Distinguish delivery-to-response from perception latency. Define tiredness as self-report per observed trip/driver-hour with reporting opportunities, not as proven sleep.

Independently corroborated incidents may use trips or covered kilometres only when numerator/outcome linkage and exposure are adequate. SQL/Python analysis must show independent drivers, trips, coverage/missingness and uncertainty alongside every rate. A second analyst must reproduce a small hand-labelled fixture and then the analysis from raw events. If a denominator or outcome is absent, withhold the rate/ranking rather than fill gaps with inferred danger.

Publish country/route/language coverage and denominators before any Latin America aggregate. Pool only comparable measures with an explicit rationale; expose uneven coverage and never present one country's observed rate as representative of the region.

Report fatigue self-reports and reported security incidents separately from independently corroborated events. Any route/hour comparison must show freight-trip or relevant driver-hour/distance exposure, repeated-driver structure and reporting opportunity. Neither a count of reports nor one silent phone establishes theft risk or sleep incidence.

Incoming flow: Preserve analytical provenance.


### Test policy bias and privacy · #42

Explicit causal trap: curves/night hours may trigger more prompts or safer deferral; a resulting response pattern may reflect our policy, traffic or coverage rather than danger. Stratify by policy/delivery/coverage and route/time exposure; account for repeated drivers and selection into the app. Do not claim adjustment removes unmeasured confounding.

Hold out whole drivers/journeys or route-time blocks to match the intended claim; do not randomly split correlated points. A fixed-policy comparison or safer shadow analysis can test whether a hotspot disappears when prompting changes. Use driver-clustered uncertainty and sensitivity to missing outcomes. Set minimum independent-driver cells and privacy suppression before release, with rationale rather than an arbitrary “anonymous” count.

Accept: an independent analyst reproduces results and their sensitivity; unsupported or sparse cells remain unranked. If the signal disappears after policy/exposure accounting, report a measurement artefact and abandon the road-risk claim. No experiment may increase distracting prompts to obtain labels.

Check country, language, carrier and route selection as possible sources of missingness or response differences. Keep unsupported or sparse country comparisons unranked; a larger pooled count does not repair absent country-level evidence.

Incoming flow: Define honest rates and intervals.


### Gate claims before sharing · #43

Release tiers: (1) observed response/coverage patterns; (2) attributed tiredness reports; (3) separately corroborated incident associations. Each has source, denominator, uncertainty, coverage window, policy version and limits. Tier 1 cannot be titled “most dangerous hours/roads”; delays near a curve or station are not evidence of crime or sleep.

Before a stronger claim, compare independent outcomes whose provenance and time/location linkage were assessed without using our alert as the label. Preserve disagreements and missing outcomes. Independent methodology/privacy review must reproduce the result and approve its wording. Small/sparse data or absent ground truth keeps the report descriptive or withheld. Authorities/companies receive only specifically approved aggregates; individual evidence export is a separate driver choice.

State the countries, languages, routes and observation window actually represented. Regional wording requires justified coverage and comparability; local observations must remain local claims, with approved recipients and country-specific release conditions recorded.

Use freight-specific descriptive titles that distinguish reported security concerns, attributed fatigue/rest and corroborated outcomes. A later stronger robbery or fatigue-risk claim must meet the independent-outcome gates; direct driver value remains the priority over institutional reporting.

Incoming flow: Test policy bias and privacy.


### Verify a real reporting use · #44

Only after the prior evidence/privacy gates, identify one actual decision a consenting agency/company would make from the approved aggregate. Assess usefulness against its existing evidence and workflow; stated interest or a willingness-to-pay answer does not validate road safety or predictive accuracy.

Deliver methodology, data dictionary and a worked decision example reviewed by a domain user and an independent analyst. Accept only if the output supports that decision within its stated uncertainty and permissions. Otherwise stop institutional reporting and retain useful driver service. No employee fatigue/safety ranking, automatic discipline or expansion of collection to rescue a weak institutional proposition.

Incoming flow: Gate claims before sharing.

