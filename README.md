# ANDES (hackathon) · GOAT

Phone-based safety support for independent Latin American freight truck drivers and owner-operators with one or two trucks. The core problems are robbery during transportation and driver fatigue/sleepiness. Separate from SurcoCheck.

Status: evidence tooling in progress (#8 evidence kit, preparatory #9 iPhone recorder). All 44 task issues remain open. No participant interviews or physical-device results are complete, Android is untested, and there is no production app or evidence of product efficacy.

## Start here

[Reconstruct freight trip incidents](https://github.com/Bimbi-Dev/andes-hackathon/issues/8) is the first task. Follow the section gates and GitHub blocked-by links.

## Work sections

| Section | Issue | Tasks |
|---|---|---|
| Validate the promise | [#1](https://github.com/Bimbi-Dev/andes-hackathon/issues/1) | 5 |
| Prepare a safe trip | [#2](https://github.com/Bimbi-Dev/andes-hackathon/issues/2) | 5 |
| Track available signals | [#3](https://github.com/Bimbi-Dev/andes-hackathon/issues/3) | 5 |
| Adapt safety check-ins | [#4](https://github.com/Bimbi-Dev/andes-hackathon/issues/4) | 6 |
| Escalate and resolve | [#5](https://github.com/Bimbi-Dev/andes-hackathon/issues/5) | 8 |
| Verify and pilot | [#6](https://github.com/Bimbi-Dev/andes-hackathon/issues/6) | 2 |
| Learn from shared data | [#7](https://github.com/Bimbi-Dev/andes-hackathon/issues/7) | 6 |

The insights section is a later, conditional phase. The verify section includes the original decision/repair loops; those are decision gates, not fabricated completed tasks.

## Ownership

Each issue has one accountable owner. Sebastian (`sebasbimbi`, 20 issues) owns driver evidence, provider access, mobile and contact UX, consent and pilot decisions. Robert (`Robertzu43`, 24 issues) owns architecture, server state, durable jobs, channel integrations and reproducible evaluation. Sebastian starts with [#8](https://github.com/Bimbi-Dev/andes-hackathon/issues/8); Robert's first task is [#12](https://github.com/Bimbi-Dev/andes-hackathon/issues/12), still blocked by #11. See the [ownership matrix](docs/OWNERSHIP.md) for every issue and handoff.

## Product and evidence

Robert’s [issue-by-issue backend roadmap](docs/superpowers/plans/2026-10-17-robert-issue-roadmap.md) links 24 proposed implementation plans, shared contracts, the integration order and subagent review workflow. These are planning artifacts; original evidence gates and open issue states remain unchanged. Robert delegated the architecture decision: [ADR-002](docs/architecture/ADR-002-aws-durable-dispatch.md) selects AWS ECS/Fargate, RDS PostgreSQL and SQS, with independent channel attempts and nonblocking trip/map closure. No runtime deployment or capacity is claimed.

Project: ANDES (hackathon). Team: GOAT. This project has its own workspace and GitHub repository, separate from SurcoCheck.

Product scope: independent freight truck drivers and owner-operators across Latin America, including Brazil, who typically own or operate one or two trucks (camiones/caminhões). The individual driver is the primary customer. Freight transport is the target use case, covering local and interurban haulage; a corporate fleet account or control centre is not required. The product is designed around the phone and trusted contacts the driver already has.

Core problems: robbery or attempted robbery during freight transportation, and fatigue or falling asleep while driving. ANDES aims to help drivers request support, keep trusted contacts informed and preserve useful security/fatigue evidence. Record phone and route observations, bounded check-ins, driving/rest context, attributed fatigue or sleepiness reports, and reported security incidents. Keep unknown, self-reported, suspected and independently corroborated events distinct.

Positioning: a direct-to-driver service for small owner-operators, with simple onboarding and individual control over sharing. The founder identifies a gap in products oriented toward large fleets. Whether current alternatives fail this segment, how common one/two-truck ownership is and what drivers will pay remain research questions; no market-share statistic or competitor capability is asserted.

Design for Spanish and Brazilian Portuguese, configurable country/locale, international phone numbers and local time zones. Additional language coverage must be stated explicitly. Validation may start with a small evidence-selected cohort and corridor in any Latin American country. Record the countries, languages and conditions actually tested; a local sample does not validate the whole region. Each enabled country/channel/language combination needs its own support evidence, with unsupported conditions shown honestly.

Critical scenarios: a freight driver requests help or reports a security incident; a driver reports tiredness and needs a safe rest/support action; or an agreed check-in/arrival is missed and the trusted contact cannot tell whether to act. Intended benefit: reduce avoidable delay to appropriate contact action without increasing driving distraction or alarm burden. Phone signal -> qualified observation/report -> bounded check-in or explicit help -> attributed/uncertain alert -> contact acknowledgement -> recorded action is the causal chain to test. Phone telemetry and missed replies alone do not establish sleep or robbery. Any later automatic detection or stronger safety claim requires independent validation; weapon detection is not an implemented capability.

H1: a bounded check-in can obtain useful status without unsafe distraction. H2: escalation can get an appropriate trusted-contact action sooner than current arrangements under supported conditions. H3: contributed observations can describe response patterns; stronger fatigue/crime/road-risk claims need independent outcomes.

Heartbeat means an “I’m OK” check-in, not cardiac pulse. Device liveness, prompt delivery, driver response and wellbeing are different facts. An OK reply is time-specific self-report; a missing reply is unknown. A careful driver on a curve may respond slowly. More prompting on that curve can manufacture a misleading hotspot.

Robbery and fatigue are the product's motivating problems. Their measurement must distinguish an attributed report (for example tiredness, suspected threat or a reported attempted robbery), the app's observations and any independently corroborated outcome. A missing reply is never a substitute for an incident label.

## Trip creation and live sharing

Core journey: while stationary, a freight driver describes a haul by voice note or natural-language text, reviews and confirms the proposed trip, then starts phone-based live location sharing with selected accepted trusted contacts. Contacts follow current location while supported observations are available, with timestamp, accuracy and explicit stale/unavailable states. The trip continues through the existing rest, check-in, help, escalation, contact-action and arrival flows. Voice/text interpretation never activates a trip or grants access without driver confirmation.

Robert owns the intake backend (#12/#16), event contracts (#18), authorised location delivery and reconnect behaviour (#21), and trip-end sharing termination (#17). Sebastian owns voice/text capture and confirmation UX (#13), contact consent (#15), phone capture (#19) and the live contact map (#22). Physical-device checks (#9) establish supported cadence, freshness and background behaviour; these features are requirements, not implemented capabilities.

## Working agreement

Authorised now: publish this existing Codus plan as open GitHub issues in the separate private Bimbi-Dev/andes-hackathon repository, team GOAT, and invite Robertzu43 with write access. The scope is independent freight truck drivers/owner-operators across Latin America, including Brazil, typically with one or two trucks. Robbery during transport and fatigue/sleepiness are the core problems; the individual driver is the primary customer. The seven sections, 63 nodes and 44 task nodes are retained; the regional requirements are incorporated into existing tasks. Sebastian has authorised starting his assigned engineering work: the #8 evidence kit and preparatory #9 iPhone recorder/protocol are in progress. Android remains untested. Real participant interviews, provider activation, trip collection and live pilots have not started; tooling does not satisfy those evidence gates.

ANDES is separate from SurcoCheck, with independent code, configuration, data and delivery ownership. Before starting a section, satisfy its evidence gate. Missing or inconclusive evidence is not a pass. Use issue closure only for completed work supported by evidence. Invitation acceptance must be reported separately from sending the invitation. Hosting deployment, spending and live pilots remain separately scoped.

Read the [complete plan](docs/PLAN.md), [portable plan and issue map](docs/plan.json) and [contribution guide](CONTRIBUTING.md).
