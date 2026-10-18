# Task 3 report — reproducible artifacts and local operation

Implemented against the finished Task 1/2 runtime contract in the explicit `codex/aws-durable-backend` worktree. No AWS account call, authentication, deployment, image push, live Zavu send, virtualization install/start or child agent was used.

## Delivered

- `infra/template.json`: plain CloudFormation; existing VPC + two explicit public/private AZ subnets; public HTTPS ALB + HTTP redirect; only ALB ingress to private API; encrypted private Multi-AZ PostgreSQL 17; separately retained/encrypted class source queues/DLQs; reserved private encrypted/versioned audio bucket with incomplete-upload cleanup only and no app access. Target-region PostgreSQL patch is required input, not a guessed default. Template size 89,982 bytes requires S3 upload.
- All four services bootstrap at zero; after documented migration success API/control become fixed two tasks. Emergency/ordinary stay zero without the explicit live flag and provider secret. Live-disabled complete provider configuration still supports API callbacks/control GET reconciliation. No autoscaler can bypass either gate. Separate task IAM matches actual adapter permissions; runtime execution secrets exclude RDS admin, bootstrap execution alone receives it.
- Shared `databaseConfig` preserves local DATABASE_URL and supports raw secret credential components, exactly-once encoding, committed official RDS CA and verified TLS without overriding SSL options. Callers updated: API, all worker roles, migration script. Dedicated retryable admin bootstrap creates/updates the SQL role, migrates, grants DML/sequence/schema rights, excludes migration-bookkeeping writes and sets future grants. Runtime has no DDL. No startup migrations or plaintext task-definition credentials.
- Fixed rolling budget: API 10 connections and each worker 2, up to four tasks/role during 200% rollout = 64; +2 bootstrap +14 operations =80 against explicit `max_connections=100`. Instance memory/reserved capacity still needs qualification. Two slots/channel/task retained; no speculative autoscaling or extra dependencies.
- Node 24 Docker image with SQL/CA and nonroot user, PostgreSQL 18 Compose, pinned cfn-lint CI, actual PostgreSQL tests, offline infrastructure assertions, synthetic demo, runtime/README/runbook/evidence docs and account-specific parameter example. Real OIDC and external AWS transport requirements are explicit.
- Synthetic demo checks confirmed trip, fresh/stale clock advancement, duplicate SOS, real child-process exit/restart against persisted SQL, expired unattempted-claim recovery, ambiguous authorization retained unknown with no resend, and contact revocation. Provider/queue boundaries are synthetic; time passage is simulated. This is not a live SQS/provider/device outage experiment.
- Root-owned reviewed architecture SVG/PNG links added; root will commit those files separately.

## Verification observed

Clean `npm ci`: 91 packages installed, audit reported zero vulnerabilities at this run. Node **24.14.1**. `npm run typecheck`; `npm test` (build + **45 tests pass, zero skipped** on disposable PostgreSQL 18); `npm run demo`; `uvx --from cfn-lint==1.57.2 cfn-lint infra/template.json`; `LOCAL_ADMIN_PASSWORD=synthetic_admin LOCAL_APP_PASSWORD=synthetic_app docker compose config --quiet`; `git diff --check` all passed.

Configuration/bootstrap tests were first run failing on missing implementation, then made passing. The real app login uses reserved-character username/password, succeeds at DML, cannot CREATE TABLE or write migration bookkeeping, and receives grants on future table/sequence objects. Pinned pg parsing verifies CA, rejectUnauthorized and credential/Unicode round-tripping while rejecting SSL overrides. These checks do not establish a real RDS TLS handshake.

CA public trust-store SHA-256: `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b` (official AWS global bundle, 2026-10-17). No secret values were committed/logged.

## Explicit limits

Docker CLI/Compose config validation are available, but `docker info` confirmed no running daemon. Image build and Compose service execution remain unverified locally; CI defines the image build but has not been observed. No cfn-guard/account pre-deployment validation, RDS TLS/failover/restore, AWS networking/quota/cost/alarms, provider account/destination/channel/template or device evidence is claimed. No credit/currency assumptions. Core location/raw-draft/audit retention remains a separate qualification; reserved audio is inactive; automatic nonresponse/fatigue escalation and human voice-answer semantics are not implemented.

`/health` remains SELECT 1; the runbook requires `RunTask.failures=[]`, exactly one task, STOPPED and expected `bootstrap` container exit code 0 before service activation, and documents failure/rollback/rotation/recovery. Injected secret changes require rollout. Retained resources remain operator-owned/billable after stack deletion. Root review/integration/push and architecture-artifact commit follow this task's commit.

## Review fix round 1 — non-superuser bootstrap retry

Reviewer finding confirmed: the original shared CREATE/ALTER clause included explicit `NOSUPERUSER`/`NOREPLICATION` on retries. A real PostgreSQL non-superuser cannot issue those ALTER attributes even when their value is false; local superuser tests masked the RDS-master portability issue.

RED: replaced the original superuser bootstrap execution with a separate actual `NOSUPERUSER CREATEDB CREATEROLE` migration login. That login creates and owns its own disposable database/public schema, then invokes bootstrap twice. On the unchanged implementation, invocation one succeeded and invocation two failed SQLSTATE `42501`, detail `Only roles with the SUPERUSER attribute may change the SUPERUSER attribute.` This reproduced locally on PostgreSQL 18; no RDS account/instance was used.

GREEN: CREATE retains explicit unprivileged defaults; an existing validated role uses only `ALTER ROLE ... LOGIN PASSWORD ...`. Existing superuser/createdb/createrole/replication/bypass-RLS flags, role memberships and database/schema/relation ownership cause a static fail-closed error before alteration. The regression logs in as the app role, checks DML succeeds and DDL/migration-bookkeeping writes fail, verifies future-object grants, and explicitly rejects all five elevated attributes, inherited-role membership and database ownership. The disposable fixture administrator alone creates those adversarial states; bootstrap still runs through the non-superuser owner for every call. Runbook/evidence now state that fixture prerequisite.

Focused `npm run build && node --test tests/database-config.test.mjs`: **2 pass**. Full `npm run typecheck`, `npm test`: **45 pass, zero skipped**, `npm run demo`, and `git diff --check`: pass. Template/Docker files unchanged, so their previously observed lint/config results still apply; no image/account/provider execution was added. Root review/push follows this fix commit.
