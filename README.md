# ANDES (hackathon) · GOAT

Mobile driver safety for Latin American owners/drivers with one or two cars. Separate from SurcoCheck.

Status: planning. The 44 task issues are open; publishing the plan does not complete implementation or establish product efficacy.

## Start here

[Reconstruct real trip incidents](https://github.com/Bimbi-Dev/andes-hackathon/issues/8) is the first task. Follow the section gates and GitHub blocked-by links.

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

Project: ANDES (hackathon). Team: GOAT. This project has its own workspace and GitHub repository, separate from SurcoCheck.

Working cohort, not validated demand: independent Peruvian owner-drivers with one or two cars who make regular interurban work trips and already rely on a trusted contact. Spanish first; choose one route corridor from their original journey records. Other Latin American markets remain outside this first validation.

Critical scenario: a driver misses an agreed trip check-in or arrival, and the contact cannot tell whether to act. Intended benefit: reduce avoidable delay to an appropriate contact action without increasing driving distraction or overwhelming contacts. Phone signal -> qualified observation -> bounded check-in -> uncertain-status alert -> contact acknowledgement -> recorded action is the causal chain to test. No claim of preventing crashes or detecting sleep, robbery or weapons.

H1: a bounded check-in can obtain useful status without unsafe distraction. H2: escalation can get an appropriate trusted-contact action sooner than current arrangements under supported conditions. H3: contributed observations can describe response patterns; stronger fatigue/crime/road-risk claims need independent outcomes.

Heartbeat means an “I’m OK” check-in, not cardiac pulse. Device liveness, prompt delivery, driver response and wellbeing are different facts. An OK reply is time-specific self-report; a missing reply is unknown. A careful driver on a curve may respond slowly. More prompting on that curve can manufacture a misleading hotspot.

## Working agreement

Authorised now: publish this existing Codus plan as open GitHub issues in the separate private Bimbi-Dev/andes-hackathon repository, team GOAT, and invite Robertzu43 with write access. The seven sections, 63 nodes and 44 task nodes retain their scope. App implementation, provider activation, participant recruitment, trip collection and live pilots have not started.

ANDES is separate from SurcoCheck, with independent code, configuration, data and delivery ownership. Before starting a section, satisfy its evidence gate. Missing or inconclusive evidence is not a pass. Use issue closure only for completed work supported by evidence. Invitation acceptance must be reported separately from sending the invitation. Hosting deployment, spending and live pilots remain separately scoped.

Read the [complete plan](docs/PLAN.md), [portable plan and issue map](docs/plan.json) and [contribution guide](CONTRIBUTING.md).
