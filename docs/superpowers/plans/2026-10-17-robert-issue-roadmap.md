# Robert’s issue-by-issue backend roadmap

Status: **AWS architecture selected by delegated decision; plans being aligned; no runtime implementation started**. Source: `docs/plan.json`, revision `evidence-gates-v5-voice-trip-live-sharing`, branch `docs/voice-trip-live-sharing` at `815d0c6` (based on `origin/main` at `470209d`). All original issues remain open. This roadmap does not change their owners or blockers.

Robert owns **24 issues: 21 delivery issues and three section coordination issues**. Each has a separate plan with scope, exact proposed files/interfaces, small tasks, verification cases and its original evidence gate. Read the [shared backend baseline](../specs/2026-10-17-robert-backend-contracts.md) before any issue plan. The authoritative [ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) selects ECS/Fargate + RDS PostgreSQL + SQS; runtime patch versions, accounts and evidence still require verification.

## The product these plans build

A stationary freight owner-operator describes a haul in Spanish or Brazilian Portuguese by voice or natural text, corrects the proposed fields and explicitly confirms. Accepted trusted contacts receive scoped access to the driver’s current phone location, with observation time, accuracy and current/stale/unavailable states. Driver OK, tiredness/rest and help reports feed bounded check-ins and attributed contact notifications. Acknowledgement, useful action and driver confirmation remain separate. Arrival/cancellation stops publication and map access. Location or a missed reply alone never establishes robbery, sleep or wellbeing.

Backend ownership includes intake and confirmation (#16), lifecycle (#17), source-labelled events (#18), conservative context (#20), authorized live snapshots/reconnect/revocation (#21), check-in policy/report APIs/deadlines (#23–27), measured comparison (#28), and incidents/delivery/action (#29–34). Sebastian owns the corresponding capture, consent and contact interfaces (#13/#15/#19/#22/#24/#35). Their contracts must be agreed at #12; frontend handoffs are dependencies, not backend features to leave without an owner.

## Confirmed emergency audience

| Recipient | Required channels for a full emergency alert |
|---|---|
| Family member or partner designated as emergency contact | SMS, WhatsApp and phone call |
| Additional person selected by the driver | SMS, WhatsApp and phone call |
| Selected driver group | WhatsApp group alert only |

Robert confirmed this routing split during brainstorming. Alerts include attributed incident information, event time and latest location with observation time/freshness. An explicit robbery/kidnapping help signal triggers the security alert. ADR-002 makes all three individual channels immediately eligible in parallel; acknowledgement does not cancel the others. Automatic missed-check-in escalation remains disabled pending its separate evidence-approved policy. This requirement supersedes the older single-channel selection in #31; #12 must revise #29–34 around the agreed design before implementation. The group path remains a required capability to investigate, with actual provider support unverified. Manual sharing alone does not fulfil automatic group notification.

Robert wants ‘I’m OK’ to actively check responsiveness with the goal of avoiding sleep at the wheel; this hypothesis remains part of the product scope, alongside tiredness/rest support. He rejects an invented alert interval. Missing a reply is unknown status, not detected sleep. Robert’s latest clarification replaces the earlier spoken-reply-only choice: initial trip entry uses voice/text, while subsequent quick actions use very large buttons. Exact layouts/cues and qualification for moving interaction remain open. Phone location/speed, geospatial context and relevant available sensors/permissions should inform contextual eligibility; actual platform capabilities and physical-device behavior remain unverified. Cadence, response window and missed-response escalation are still open. The fatigue/rest flow remains under discussion; no automatic detector, keep-awake prompting policy or numeric cadence is approved. See the shared baseline’s security/fatigue distinction before revising #18/#23/#26/#29.

Contextual check-ins are now an explicit requirement: defer on curves/demanding maneuvers, pause for refuelling/out-of-truck stops, and seek repeated valid responses before a non-response alarm. Suppression or unavailable audio does not count as a failed response; repeated attempts must each re-evaluate context. No universal interval or retry count is selected. Stop declaration/resumption, prolonged inability to check and escalation rules remain open. The fixed-policy drafts in #23–27 require revision before execution; retain them only as comparison fixtures where useful.

## Product understanding and scoring govern every issue

Robert first requested shared brainstorming and then delegated the final architecture decision after independent review. ADR-002 now governs the selected topology and ordering semantics. Preserve the agreed product brief: the driver and trusted contact, the real trip/security scenario, their current workaround, its evidenced failure, the action ANDES enables, the smallest complete demonstration and its limitations. Separate confirmed user requirements from research hypotheses. Voice/text intake and phone-location sharing are confirmed requirements; willingness to pay, better outcomes than current arrangements and useful contact response remain hypotheses until evidenced.

Understand the contact's role as carefully as the driver's: who receives the information, what they can do, when they need it and what happens if nobody can act. Keep the Security-track problem explicit; freight is the user context. The official guide includes transport-operator security. Do not promise robbery prevention or automatic fatigue detection from tracking/check-ins.

Official [judging guide](https://hacktheandes.com/guide), rechecked 2026-10-17: each criterion is scored 1–5; total = traction × 6 + technical effort × 8 + pitch × 6. The applications below are our planning interpretation, not additional judging rules or guaranteed points.

| Criterion | Weight | What our work should make demonstrable |
|---|---|---|
| Technical effort | 40% | A functioning end-to-end trip/contact flow, meaningful integrations, justified architecture, and verified handling of important failures. Infrastructure complexity alone is not evidence. |
| Traction | 30% | Verifiable driver/contact learning, interest and, when available, actual use or demand. Record who tested what, what changed and limitations; synthetic tests and teammates are not external adoption. |
| Pitch | 30% | A clear user/problem/value story, a reliable three-minute demonstration and precise answers during two minutes of questions. Make supported behavior and remaining limits visible. |

Before starting **every issue**, record five short answers in its working acceptance record: whose problem this solves; the exact journey step; which rubric criterion it supports and the expected evidence; how it appears in the demo or enables an essential dependency; and the time/tradeoff compared with a smaller solution. Supporting infrastructure may contribute indirectly, but must name the user-visible capability it enables. Revisit these answers at review and scope changes. Completing all 24 issues is not itself the hackathon success criterion; protect time for external validation and pitch preparation alongside engineering without waiving original safety/evidence gates.

## Selected architecture and remaining acceptance gates

[ADR-002](../../architecture/ADR-002-aws-durable-dispatch.md) resolves the seven demo questions and supersedes historical ADR-001: ECS/Fargate API/control/delivery roles, RDS state, outbox to SQS, independent channel attempts and short SQL authorization transactions. The global dispatch fence is retired. Previously authorized calls may complete after closure/revocation; future affected authorizations are blocked. Trip arrival closes live sharing/check-ins but does not resolve a security SOS. Android installed is selected for initial device validation, web for contacts/demo; availability and safe interaction remain untested.

[#12 evidence](../../evidence/issue-12.md) separates the delegated design choice from missing actual device/provider evidence. #12 remains open and blocked by original #11. Architecture review and plan alignment are active; no runtime or real channel delivery is claimed. Obtain actual #9–11 inputs and frontend handoff, verify hosting access/budget, and freeze implementation contracts before the first eligible implementation slice. Do not ask Robert to select AWS again; the decision was delegated.

Once the original gates pass, integrate in this order:

1. **Trip foundation:** #14 → Sebastian #15 → #16 → #17; coordinate with his #13 preparation and section #2 acceptance.
2. **Truthful tracking:** #18 → Sebastian #19 → #20 → #21 → Sebastian #22 → section #3 acceptance.
3. **Bounded check-ins:** #23 → Sebastian #24 → #25 → #26 → #27 → #28 → section #4 acceptance.
4. **Useful escalation:** #29 → #30 → #31 → #32 → #33 → #34 → Sebastian #35/#36 → section #5 acceptance.
5. **Later, conditional analysis:** after verification/pilot decisions and Sebastian’s #39 contribution consent, #40 → #41 → #42. Sebastian retains #43 release approval and #44 reporting-use validation.

This is integration order, not an invented dependency graph. The table below preserves GitHub’s exact original blockers; each issue plan also names required interface/evidence handoffs. Section #3/#4/#5 plans collect child evidence and the final disposition, rather than reimplementing child features. Keep those section records current while working through their children.

## One plan for every Robert issue

| Issue and plan | Original blocker | Deliverable |
|---|---|---|
| [#12 — Record evidence-led decisions](2026-10-17-issue-12-architecture.md) | #11 | Architecture, support matrix and frozen contracts |
| [#14 — Verify driver and trucks](2026-10-17-issue-14-identity-trucks.md) | #13 | Identity, recovery and driver/truck scope |
| [#16 — Register the trip and limits](2026-10-17-issue-16-confirmed-trip-registration.md) | #15 | Voice/text drafts, confirmation and durable trip registration |
| [#17 — Prove pause and arrival rules](2026-10-17-issue-17-trip-lifecycle.md) | #16 | Rest, extension, arrival, cancellation and dispatch ordering |
| [#18 — Define auditable trip events](2026-10-17-issue-18-auditable-events.md) | #2 | Typed events, provenance and timeline reconciliation |
| [#20 — Qualify road and time context](2026-10-17-issue-20-conservative-context.md) | #19 | Conservative road/time context with unknown states |
| [#21 — Make coverage gaps explicit](2026-10-17-issue-21-location-reconciliation.md) | #20 | Authorized location ingestion, polling, gaps and revocation |
| [#3 — Track available signals](2026-10-17-issue-03-tracking-coordination.md) | #2 | Tracking section evidence and acceptance |
| [#23 — Specify a falsifiable policy](2026-10-17-issue-23-falsifiable-policy.md) | #3 | Contextual policy, fixed comparison baseline and evidence-backed limits |
| [#25 — Separate delivery from response](2026-10-17-issue-25-delivery-response.md) | #24 | Independent delivery/response clocks and missingness |
| [#26 — Test adaptive follow-up rules](2026-10-17-issue-26-adaptive-follow-up.md) | #25 | Bounded adaptation and authenticated driver-report integration |
| [#27 — Prove deadline and race handling](2026-10-17-issue-27-durable-deadlines.md) | #26 | Durable deadlines, restart and race handling |
| [#28 — Compare benefit and burden](2026-10-17-issue-28-benefit-burden.md) | #27 | Held-out comparison of benefit and burden |
| [#4 — Adapt safety check-ins](2026-10-17-issue-04-checkin-coordination.md) | #3 | Check-in section evidence and acceptance |
| [#29 — Define action and uncertainty](2026-10-17-issue-29-incident-action-state.md) | #4 | Attributed incidents, scoped contact response and action facts |
| [#30 — Prove durable notification jobs](2026-10-17-issue-30-durable-notification-jobs.md) | #29 | Transactional notification jobs and supervised execution |
| [#31 — Qualify contact notifications](2026-10-17-issue-31-qualified-provider-dispatch.md) | #30 | Qualified channels, localized payloads and provider adapter |
| [#32 — Separate receipt from action](2026-10-17-issue-32-authenticated-provider-callbacks.md) | #31 | Authenticated callbacks; receipt separated from action |
| [#33 — Bound retries and reconciliation](2026-10-17-issue-33-bounded-retries-reconciliation.md) | #32 | Bounded retry, fallback and ambiguous-send reconciliation |
| [#34 — Gate colleague-group delivery](2026-10-17-issue-34-colleague-group-eligibility.md) | #33 | Required group eligibility/transport or explicit missing capability |
| [#5 — Escalate and resolve](2026-10-17-issue-05-escalation-coordination.md) | #4 | Escalation section evidence and acceptance |
| [#40 — Preserve analytical provenance](2026-10-17-issue-40-contribution-provenance.md) | #39 | Consented contribution provenance and withdrawal |
| [#41 — Define honest rates and intervals](2026-10-17-issue-41-rates-and-intervals.md) | #40 | Rates, exposure denominators and clustered intervals |
| [#42 — Test policy bias and privacy](2026-10-17-issue-42-bias-and-privacy.md) | #41 | Holdout leakage, policy bias and privacy suppression |

## Controlled subagent execution

The selected execution method is **subagent-driven**, preserved from Robert’s request. Three subagents drafted independent domains; the coordinating agent performs the complete plan’s own coverage, signature and dependency review. During implementation, use the required `superpowers:subagent-driven-development` workflow after plan review.

For each issue:

1. **Select:** apply the five product/scoring questions above, then record original blockers, accepted contract revision, missing evidence and the exact bounded task. Give each implementer/reviewer that product context. If a gate is missing, prepare only the authorized documents/fixtures and report the blocker.
2. **Implement:** assign a fresh implementer that task’s files and contracts. Write the named failing behavior check, implement the smallest change, run the focused verification and commit only the reviewed scope.
3. **Review:** a fresh reviewer checks spec compliance; then a fresh reviewer checks code quality/security. The implementer fixes findings before the next task starts. Keep each pass tied to the actual revision.
4. **Integrate:** the coordinator alone edits common contracts, manifests, lockfile, migration manifest, route registration and shared test helpers. Run the issue suite plus directly affected caller/race tests; do not rerun unrelated expensive evidence checks without a reason.
5. **Accept or iterate:** record engineering results separately from missing real-device/provider/independent evidence in `docs/evidence/issue-XX.md`. Failures return to the smallest owning task. Close only after the original issue’s full acceptance gate passes.

Use one active implementation issue at a time. Up to three child agents may work concurrently only on independent, already-unblocked tasks with disjoint files and frozen interfaces, such as a read-only evidence inventory or independent fixtures. A reviewer runs after the implementation it reviews. Do not launch the entire backlog in parallel, and do not have agents concurrently edit shared schema or route registration. Use isolated worktrees when implementation starts.

Issue progress has two separate axes: **engineering** (`planned`, `active`, `checked`) and **evidence** (`missing`, `failed`, `ready`, `accepted`). Architecture preparation #12 is `active` / `missing`; runtime work remains planned, and no issue is evidence-accepted. Record the commit, commands, failed cases, evidence references, reviewer findings and next action; an AI review is engineering review, not an independent recipient, driver or analyst observation.

## Hackathon delivery and practical limits

Prioritize the reviewable end-to-end story: describe haul → confirm → accepted contact sees phone location → explicit help or justified missed check-in → contact acknowledgement/action → arrival removes live access. Exercise it with two independent users and a fresh browser. Demonstrate stale/offline and revoked-link states, server restart and duplicate confirmation alongside the happy path. Real physical-phone capture and provider receipts must be labelled separately from synthetic demonstrations.

The hackathon’s [guide](https://hacktheandes.com/guide) weights technical effort 40%, traction 30% and pitch 30%, with a three-minute pitch and two minutes of questions. Keep the live app URL, repository, presentation and Markdown description reproducible from the organizers’ computer; evidence of actual useful contact action supports the story, while an elaborate infrastructure diagram alone does not. Recheck event logistics before submission. Demo publication and authorized participant work remain separate execution tasks.

The selected backend is one modular codebase with ECS/Fargate API/control/delivery roles, RDS PostgreSQL state and separate emergency/ordinary SQS transport. Provider I/O holds no SQL lock or client. Include CI, startup/shutdown, secrets, health, migration/rollback and recovery contracts in the first working slices. Add no speculative microservices, Redis, Kubernetes, always-on socket service or automatic crime/fatigue classifier. Polling transports snapshots; #9’s measured device states determine when the phone can supply fresh locations.

Robert selected Zavu for individual SMS, WhatsApp and calls and authorized use of applicable available Andes credits. Identity, transcription and map providers remain undecided. The relevant plans explicitly require verified operations and account limits before a real adapter can be implemented/enabled. No safety timing values are selected by these plans. Automatic group delivery stays disabled unless its own evidence and implementation are added. Analytics #40–42 is a later consent-gated phase, not a prerequisite for the core demo.

## Review handoff

Use ADR-002 as the selected design and the fresh review as its rationale. Validate contracts against the updated #17/#21/#26/#27/#29–34 plans, preserve original evidence gates, and continue issue by issue with the already selected subagent workflow. Design selection does not establish hardware/provider readiness or issue closure.
