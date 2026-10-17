# Hack the Andes delivery board

Start here if you are working toward team GOAT's submission. Rules come from the [team guide](https://hacktheandes.com/guide) and [participation terms](https://hacktheandes.com/participation-terms), rechecked 2026-10-17 17:50 -05. Live state comes from `andes --output json team` and `andes --output json project`.

## How we are scored

Each judge scores 1–5 per criterion; score = traction × 6 + technical × 8 + pitch × 6 (max 100). Team score is the average of submitted judge evaluations.

| Criterion | 3 = | 5 = | Where we are |
|---|---|---|---|
| Technical effort (40%) | Working product with its own logic and integrations | Solid engineering, justified decisions, hard problems solved | Strong backend, but nothing a judge can open yet. Until a URL works, it reads as "not working" (1). |
| Traction (30%) | Interviews or verifiable signs of interest and learning | Real use, retention or demand, with evidence | 1: no external evidence collected yet. |
| Pitch (30%) | Understandable explanation and demo | Convincing, clear demo, precise answers | Not started; drafts in progress. |

Cheapest points: traction 1 → 3 is +12. A few consented driver/contact interviews today, using Sebastian's [interview guide](https://github.com/Bimbi-Dev/andes-hackathon/blob/sebasbimbi/feat/issue-8-evidence-kit/evidence/guides/interview.es.md), gets there.

## Rules that can sink us

- One submission per team, four fields: **deployment URL**, **presentation URL**, **GitHub URL**, **Markdown description** (problem, who it is for, how it works, limitations).
- Organizers open the links on **their own computer**: private window, signed out, no access requests, no pending permissions, no local files. Our laptops cannot be connected.
- **Jury snapshot:** when evaluation opens, the organizers snapshot the submission, links and updates. Later edits do not reach the jury. No deadline is published, so submit early and edit field by field.
- Pitch: 3 minutes plus 2 minutes of questions. Keep what works separate from what is still an idea.
- Updates (`andes project update`): post after a decision, user test, working demo or blocker. Assume everything becomes public: no secrets, voucher codes or personal data.

## Status — 2026-10-17 17:55 -05

Team GOAT, track `security`, both members checked in. Submission: **none**. Mentor updates: **0**.

| Deliverable | State | Blocker | Owner |
|---|---|---|---|
| GitHub URL | Repo is **private** (404 when signed out) | Must be public for organizers to open it. PR #54's privacy line conflicts. The backend is not on `main` (no PR from `codex/aws-durable-backend`). | Robert + Sebastian |
| Deployment URL | None | No hosting. The API accepts only OIDC tokens and there is no browser sign-in. The web UI is waiting on Sebastian's design contract (PR #56). | Robert (API, hosting), Sebastian (web) |
| Presentation URL | None | Drafts in progress | Robert |
| Markdown description | None | Draft from verified facts only | Robert |
| Traction evidence | None | No interviews yet | Sebastian (#8), both |

## What works today (verified)

`codex/aws-durable-backend` @ `c752de8`, against a disposable PostgreSQL 18:

- `npm test`: 47/47 pass (trip/consent/location/SOS API, durable dispatch, Zavu boundary, infrastructure assertions).
- `npm run demo`: synthetic journey covering:
  - trip confirmation;
  - location going fresh → stale;
  - a duplicate SOS producing one incident and three independent channel jobs;
  - a real process kill/restart that recovers work without resending;
  - revocation blocking map reads.

Not done: live sends, deployment, phone capture, voice intake (returns 422), browser sign-in.

## Demo story (target for the 3-minute pitch)

1. Driver types the haul, reviews the draft and confirms. Voice is out of scope for the demo.
2. A trusted contact sees location with age and accuracy; it turns stale honestly.
3. Driver taps SOS. Family gets SMS, WhatsApp and call jobs; the driver group shows as unavailable.
4. *(Part 1)* Driver goes silent → app asks "Estoy bien" → no answer → contacts are told "no sabemos qué pasó".
5. Contact acknowledges and records an action.
6. Arrival ends map access.
7. *(Part 2)* Hotspot map labelled "incluye datos de demostración".

Parts 1 and 2 are specified in `docs/superpowers/specs/2026-10-17-security-checks-incident-data-design.md` (local branch `docs/voice-trip-live-sharing`, not pushed).

## Who is on what

| Lane | Where | Scope |
|---|---|---|
| Codex (Robert's backend agent) | `codex/aws-durable-backend` | Backend base; not building Part 1 |
| Claude `andes-hackathon-a4` | `hackathon/delivery` | Part 1 (migration 003, `src/checks/`), demo personas sign-in, AWS demo deploy, this board, submission package |
| Claude `andes-hackathon-ef` | `feat/incident-insights` | Part 2: migration 004, `src/insights/`, demo seed |
| Sebastian | PRs #52–#60 | Web foundation, typed client, runtime harness, acceptance checks |

## Decisions (Robert, 2026-10-17 18:00 -05)

- **Hosting:** AWS fast path. The same Docker image runs on a single HTTPS service with a small RDS PostgreSQL and real SQS, labelled as a demo deployment. ADR-002's ECS/Multi-AZ template remains the production design shown in the pitch. Robert approves each paid step.
- **Sign-in:** demo personas. With `DEMO_MODE` on, the server mints short-lived tokens for seeded synthetic people behind "Entrar como…" buttons. Off by default; never in production.
- **Part 1:** built by `andes-hackathon-a4`, test-first, per the approved spec.
- **Still open:** making the repo public (with Sebastian, PR #54), a backend → `main` PR, live Zavu sends to one consented test phone, first mentor update.

## Rules for agents

- Read this file, then [`docs/contracts/runtime.md`](contracts/runtime.md). Do not edit files another lane owns; ask first.
- Tests: any disposable PostgreSQL 15+, `TEST_DATABASE_URL=… npm test`. Never point it at real data.
- Never without Robert's explicit go-ahead: deploy, spend, set `ZAVU_LIVE_SEND=true`, change repo visibility, submit the project or publish an update.
- Never commit secrets, voucher codes, phone numbers or real trip data.
