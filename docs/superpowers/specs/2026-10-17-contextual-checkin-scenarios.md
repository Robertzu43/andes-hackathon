# Contextual check-in scenario inventory

Status: brainstorming input for Robert, not an approved policy or implementation plan. Sources: Robert's contextual-check/curve/refuelling/repeated-verification requirements and latest large-button/phone-sensor direction; `docs/PLAN.md` #9/#19–27/#29–36. These are plausible cases to test, not observed frequency, device capabilities or validated fatigue detection. No numeric cadence/retry threshold is selected.

Latest interaction decision: voice/text for initial trip entry, very large buttons for subsequent quick actions. Audio recognition cases below are conditional evaluation cases if optional voice is retained, not a requirement to implement voice check-ins. Also evaluate locked/unreachable screens, accidental/double taps, taps by another person and stale controls after a state change. Button size alone does not qualify interaction while moving.

The aim is to distinguish inability to interact, declared absence, technical unavailability and unexplained non-response before escalation. Do not assume the phone can automatically identify every situation below. A candidate cue needs source, freshness, uncertainty and evidence before it can control a live interaction. Failure to observe a hazard is not proof that prompting is safe.

| ID | Situation | Evidence or uncertainty to preserve | Proposed behavior to discuss |
|---|---|---|---|
| C01 | Curve, overtaking, intersection, reversing or narrow construction zone | Qualified context where available; several maneuvers may not be detectable | Defer ordinary check-ins; do not consume a missed-response attempt. |
| C02 | Heavy rain, fog, demanding descent or poor visibility | Map geometry alone does not establish workload; driver reports may help | Defer when demanding conditions are known; do not label a straight road safe by default. |
| C03 | Traffic queue, toll, inspection, weighing station or police control | Near-zero speed is not proof of an available driver | Keep temporary stopping separate from declared rest/availability. |
| C04 | Fuel, restroom, meal or brief out-of-cab stop | Explicit stop declaration versus unconfirmed POI proximity | Pause check-ins under the agreed stop flow; keep security SOS available. |
| C05 | Loading/unloading, paperwork or vehicle inspection | Trip remains open while driving activity is paused | Support an operational stop; do not demand repeated replies while the driver works. |
| C06 | Planned sleep/rest | Explicit declared rest; phone silence is expected | Suspend active responsiveness checks; do not interpret expected sleep as a new emergency. |
| C07 | Forgotten pause or forgotten resume | Contradiction between declared state and later observations | Do not silently resume, declare sleep or remain reassuring forever; design an explicit discrepancy procedure. |
| C08 | Phone left in cab while driver exits | Phone position does not identify driver presence | Preserve uncertain presence; GPS still moving/stationary cannot answer who has the phone. |
| C09 | Telephone call, navigation instruction or conflicting audio | Actual audio availability/delivery is unknown until evidenced | Defer/reassess; do not compete with navigation or count an unplayed prompt as unanswered. |
| C10 | Engine/radio noise, wrong audio output or disconnected Bluetooth | Played audio is not proof it was heard; microphone input may be unusable | Record technical uncertainty rather than inferred driver unresponsiveness. |
| C11 | Ambiguous recognition, accent, “no estoy bien” or partial speech | Exact attributed interpretation/confidence; no substring matching for OK | Do not turn negation or uncertain speech into reassurance; qualify both languages and cab noise. |
| C12 | Passenger, radio, recording or the app's own audio answers | Recognized words do not establish speaker identity | Never silently attribute an unqualified response to the driver; attribution approach remains open. |
| C13 | Tunnel, weak coverage or complete loss of connectivity | Capture, upload, server receipt and location freshness are separate | Report coverage loss; no network silence-to-sleep inference. Local behavior needs its own tested contract. |
| C14 | App closed/suspended, permission revoked, dead battery or unavailable microphone | Last known capability versus current unknown; cause may be indistinguishable remotely | Show unavailable monitoring and last observation time; use a separate agreed loss-of-coverage policy. |
| C15 | GPS jump, parallel road or stale map sample | Accuracy, age and uncertain map match | Do not schedule from an unjustified curve/POI match or infer a dangerous deviation from a single sample. |
| C16 | Driver deliberately postpones interaction to concentrate | A legitimate reason for silence can exist even when audio played | Reassess opportunity before further attempts; no escalating prompt storm. |
| C17 | Several distinct valid prompts go unanswered | Each attempt's eligibility, delivery evidence, response window and uncertainty | Candidate escalation for unconfirmed status; exact limits/audience remain open. Duplicate prompts do not count as new evidence. |
| C18 | No eligible opportunity for a prolonged period | Persistent deferral differs from repeated valid non-response | Separate bounded inability-to-check handling; never invent failures or imply monitoring is sufficient. |
| C19 | Context becomes available again after a curve, stop or outage | Backlogged events versus current opportunity | No burst of queued prompts; reassess current state before scheduling new work. |
| C20 | Delayed/duplicate OK arrives after SOS or trip closure | Observation time, receipt time, causal order, trip and prompt identity | Do not cancel newer help or reopen a finished trip; deduplicate. |
| C21 | Driver swap, truck swap or device/session change | Driver, truck, trip and device are distinct identities | Require explicit reassignment/resumption; an old response cannot reassure about a new driver. |
| C22 | Accidental SOS, or an OK/cancellation under coercion | A normal OK is not evidence that a security incident ended | Design security resolution separately; do not auto-cancel SOS with an ordinary check-in reply. |
| C23 | Family unavailable, call reaches voicemail, contact acknowledges but cannot help | Delivery, acknowledgement, responsibility and useful action are distinct | Preserve no responder/action pending; reassignment/escalation must follow an agreed procedure. |
| C24 | Recipient has two roles, multiple contacts respond, or group/channel fails | Unique people, individual channel outcomes, current grants and ownership | Avoid duplicate attempts caused by overlapping roles; display who accepted responsibility and unmet delivery. |

## Proposed prioritization for the first evaluation

Start with curve/defer, declared stop/pause-resume, audio unavailable, ambiguous or non-driver reply, coverage loss, repeated valid non-response, late OK after SOS, and no contact able to act. Use synthetic/stationary scenarios first; moving interaction requires the existing #24 independent assessment. Do not induce fatigue or a real emergency to test the app.

Each case should record: what is known, what is merely inferred, expected prompt behavior, whether an attempt counts, what the contact sees and which evidence would disprove the rule. Include ordinary journeys as counterexamples. A response observation is not a validated alertness measurement, and repetition alone does not establish prevention efficacy.

The Security SOS flow remains independent of ordinary check-in suppression. Check-in pause, location-sharing permission and trip closure are separate decisions. A fuel/rest stop must not silently revoke sharing or disable a driver's request for help.

## Next product decision

The [published-contract gap reconciliation](2026-10-17-contextual-checkin-contract-gaps.md)
maps these cases to the current backend, proposed bounded declarations and two
independent clocks. It is review input for Robert; no runtime policy is activated.

How should drivers declare and end operational stops, and what happens if declaration/resumption is forgotten? Large stop/resume buttons match the latest interaction direction; exact labels, stop reasons, intent confirmation and resumption semantics remain to be agreed. Automatic POI-based pausing is not assumed.
