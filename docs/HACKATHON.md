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

## Status — 2026-10-17 19:00 -05

Team GOAT, track `security`, both members checked in. Submission: **none**. Mentor updates: **0**.

| Deliverable | State | Blocker | Owner |
|---|---|---|---|
| GitHub URL | Repo is **private** (404 when signed out) | Must be public for organizers to open it; PR #54's privacy line conflicts. The backend is not on `main`. | Robert + Sebastian |
| Deployment URL | Deploy script ready ([`infra/demo/deploy.sh`](../infra/demo/deploy.sh)), nothing created | Needs Robert's personal AWS profile (`andes`). Web screens are in Sebastian's PRs, not merged yet. | Robert (API, hosting), Sebastian (web) |
| Presentation URL | None | Script, slides and Q&A drafts in progress | Robert |
| Markdown description | Draft: [`docs/submission/descripcion.md`](submission/descripcion.md) | `[[PENDIENTE]]` fields: URLs, interviews, real delivery | Robert |
| Traction evidence | None | No interviews yet; Sebastian's #8 kit has the ES/PT interview guides | Sebastian (#8), both |

## What works today (verified)

`hackathon/delivery` @ HEAD, against a disposable PostgreSQL 18:
- `npm test`: 67/67 pass. That covers the original 47 (API, durable dispatch, Zavu boundary, infrastructure) plus Part 1 security checks and demo personas.
- `npm run demo`: unchanged synthetic journey covering confirmation, fresh → stale location, duplicate SOS, process kill/restart without resend, and revocation.
- `DEMO_MODE=true node dist/server.js` was smoke-tested over HTTP: health, persona session, tokens, and a forged token returning 401.

Part 1 has been through a plan review (applied and run on a scratch copy) and a code review; the review fixes are in `484e0f0`.

Not done: live sends, deployment, phone capture, voice/free-text trip extraction (fields are entered), merged web screens.

## Integration

`codex/aws-durable-backend` is the integration branch: Sebastian's client and web PRs (#55–#65) target it. Plan:
- `hackathon/delivery` (Part 1, personas, deploy, submission) goes in through a PR once Robert approves opening it.
- Part 2 (`feat/incident-insights`, not pushed yet) goes in the same way.
- After that, the integration branch merges to `main` for judging.

Expected merge conflicts are trivial:
- `src/api/app.ts`: Part 2 edits the auth-exemption line next to the demo exemption line.
- `src/notifications/dispatch.ts`: #61 refreshes the clock in `authorizeJob` in a different hunk from the alert wording.

## Demo story (target for the 3-minute pitch)

1. Judge presses "Entrar": an isolated synthetic driver, family contact and colleague are created.
2. Driver enters the haul (origin, destination, expected arrival, truck), picks contacts and confirms.
3. A contact sees location with age and accuracy; it turns stale honestly.
4. Driver goes silent → the server opens a check → "Estoy bien" → no answer → family (SMS, WhatsApp, call) and colleague (SMS, WhatsApp) are alerted: "no sabemos qué pasó". Delivery shows per channel; without Zavu live it shows "not enabled".
5. Contact acknowledges and records an action. Driver resolves; arrival ends map access.
6. Public hotspot map at `/mapa`, labelled "incluye datos de demostración"; a real hotspot needs 3 distinct people.

Do not press SOS after a missed-check alert already went out: the incident upgrades but sends nothing new.

## Who is on what

| Lane | Where | Scope |
|---|---|---|
| Codex (Robert's backend agent) | `codex/aws-durable-backend` | Backend base and integration branch |
| Claude `andes-hackathon-a4` | `hackathon/delivery` | Part 1, demo personas, ECS Express deploy, this board, submission package |
| Claude `andes-hackathon-ef` | `feat/incident-insights` | Part 2: migration 004, `src/insights/`, `/mapa`, demo seed, architecture justification |
| Claude `andes-hackathon-5d` | Its own scratchpad | Read-only review and merge of open PRs on behalf of Robert |
| Sebastian | PRs #52–#72 | Web foundation, driver and contact flows, typed client, list reads (#65), runtime harness, visuals |

## Decisions (Robert, 2026-10-17)

- **Hosting:** AWS ECS Express Mode on Robert's **personal** AWS account (never the shared AptsNY account; the script refuses it). One Fargate task runs API + control, with RDS PostgreSQL 18.3 db.t4g.micro and two SQS queues, about $2/day. It is labelled a «demo reducida»; ADR-002's HA template remains the production design. Robert approves each paid step, and teardown follows judging.
- **Sign-in:** demo personas (`DEMO_MODE`). Off by default; never with real users or live sends.
- **Part 1:** built by `andes-hackathon-a4` (done).
- **Still open:** opening PRs into the integration branch; making the repo public (with Sebastian, PR #54); live Zavu sends to one consented phone (demo mode currently refuses live sends); first mentor update.

## Rules for agents

- Read this file, then [`docs/contracts/runtime.md`](contracts/runtime.md). Do not edit files another lane owns; ask first.
- Tests: any disposable PostgreSQL 15+, `TEST_DATABASE_URL=… npm test`. Never point it at real data.
- Never without Robert's explicit go-ahead: deploy, spend, set `ZAVU_LIVE_SEND=true`, change repo visibility, submit the project or publish an update.
- Never commit secrets, voucher codes, phone numbers or real trip data.
