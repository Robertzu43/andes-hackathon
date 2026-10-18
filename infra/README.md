# AWS backend artifacts and runbook

`template.json` is the production design in plain CloudFormation (linted by `cfn-lint` in CI). It has not been deployed. The live hackathon demo runs from [`demo/deploy.sh`](demo/deploy.sh) on ECS Express with a single task. See the [architecture diagram](../docs/architecture/diagrams/andes-infrastructure-professional.svg).

## Boundaries and required inputs

Supply an existing VPC, two public subnets and two private subnets. Each pair must span two different AZs in the same VPC. Verify VPC DNS support/hostnames, IGW routes for public subnets, and resilient HTTPS internet egress from each private subnet using existing NAT/proxy infrastructure. External OIDC JWKS and Zavu need that internet path. Private ECR pulls, Secrets Manager, CloudWatch Logs and SQS must also be reachable. Endpoints alone cannot reach external JWKS/Zavu; if used, ECR needs `ecr.api`, `ecr.dkr` and the S3 gateway endpoint, with reachable Secrets Manager/Logs/SQS endpoints and correct private DNS/policies/security groups. This template creates no VPC, NAT or endpoints.

Other inputs: existing immutable ECR image digest/repository ARN, Linux x86_64 image, validated ACM certificate in the ALB region, trusted OIDC issuer/audience/HTTPS JWKS URL, unique stable `QueuePrefix` (maximum 60 characters), monitored SNS alarm topic, and a region-supported PostgreSQL **17 patch version**. Verify instance/version compatibility and quotas in the target region before choosing these values. No patch is guessed. Local/CI uses PostgreSQL 18; qualify PostgreSQL 17 on RDS before activation.

ALB permits the configured audience on HTTPS 443 and redirects HTTP 80. Only ALB can reach API port 3000; workers have no ingress. Tasks have no public IP and the database is private, encrypted, Multi-AZ, TLS-required and retained with seven-day backups/deletion protection. Only API/worker task groups reach port 5432. Task HTTPS egress is required for startup and external dependencies. Create an application DNS alias/CNAME pointing to `AlbDns` with a hostname covered by the supplied certificate; the AWS ALB DNS name itself is **not** a usable certified application URL. DNS/hosting/frontend resources are outside this template.

API, control, emergency and ordinary are independent Fargate On-Demand services from one image. Defaults leave **all services at zero**. After the separate bootstrap succeeds, `ServicesEnabled=true` starts API/control at two tasks each. Emergency/ordinary remain zero until `LiveSendEnabled=true` and a provider secret ARN is supplied. No autoscaler exists, so it cannot bypass bootstrap or live qualification. API/control can run with sends disabled, including authenticated callbacks and read-only known-message reconciliation when complete provider configuration is retained. Delivery processes independently refuse startup without qualified live configuration.

Each class has a Standard SQS source queue (four-day retention, visibility 30 seconds, five receives before DLQ) and its own 14-day DLQ. SQL/outbox is authority; queues contain IDs/version/class only. Control task role can send only to the two sources. Consumers can receive/delete/change visibility on their source only. API has no SQS permission. No runtime role can redrive/purge a DLQ, access audio S3, or fetch secrets. ECR authorization is the necessary `Resource: "*"` exception; repository pulls/log writes/secrets are otherwise scoped. Resource TLS-deny policies necessarily use action/principal wildcards to deny insecure access.

Reserved S3 is private, encrypted, versioned and retained, with incomplete multipart cleanup after one day only. There is no audio upload permission, API, transcription pipeline or asserted audio-retention period. An approved audio policy must precede collection.

## Build and offline checks

Requirements: Node 24, npm, Python with cfn-lint **1.57.2**, and Docker Engine/Compose for container checks. Local database tests require PostgreSQL 15+ and a disposable database whose test owner can create schemas/roles. The bootstrap regression fixture needs a disposable cluster administrator to create adversarial elevated roles (CI uses its disposable PostgreSQL superuser); bootstrap itself runs twice through a separate actual non-superuser `CREATEDB CREATEROLE` login owning its disposable database/schema. Never point `TEST_DATABASE_URL` at live data.

```sh
npm ci
npm run typecheck
export TEST_DATABASE_URL='postgresql://LOCAL_TEST_USER:LOCAL_TEST_PASSWORD@localhost:5432/andes_test'
npm test
npm run demo
uvx --from cfn-lint==1.57.2 cfn-lint infra/template.json
# Docker daemon required; no AWS/provider credentials needed:
docker build --platform linux/amd64 -t andes-backend:local .
LOCAL_ADMIN_PASSWORD=synthetic_admin LOCAL_APP_PASSWORD=synthetic_app docker compose config --quiet
```

`npm test` builds and runs actual PostgreSQL tests plus infrastructure assertions. CI also runs the synthetic demo, lint, Compose config and Linux image build. No provider key is a safe test key; tests inject synthetic HTTP/queue boundaries and make no live sends. The committed public RDS CA bundle was obtained from the [official trust store](https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem); record/update its checksum when refreshing it and rerun the driver tests. The image copies the bundle and SQL migrations, runs Node 24 as nonroot, and does not auto-migrate on startup.

## Local operation

Compose requires a Docker daemon. Set local-only passwords without committing them, and start the database before running the one-off bootstrap:

```sh
export LOCAL_ADMIN_PASSWORD='choose-a-local-only-admin-password'
export LOCAL_APP_PASSWORD='choose-a-different-local-only-app-password'
docker compose up -d db
docker compose run --rm bootstrap
# Set OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL to your actual trusted issuer first.
docker compose --profile api up -d api
curl --fail http://127.0.0.1:3000/health
```

Compose has no synthetic identity issuer or credentials fallback. Without complete trusted OIDC settings the API refuses startup. Existing mobile/web clients must obtain real signed access tokens from that issuer; there is no login UI in this backend. Local PostgreSQL traffic is plaintext on loopback/Compose networking; AWS always uses verified TLS. To run the credential-free synthetic scenario, create a separate disposable `andes_test` database with your local admin, set `TEST_DATABASE_URL`, then run `npm test` / `npm run demo` on the host. Tests create/drop unique schemas and a temporary bootstrap role; they do not use the normal Compose `andes` schema.

Production worker startup uses the real AWS SDK SQS adapter only. There is no local fake-SQS URL switch or automatic provider simulator. To operate control against separately authorized real queues, build on the host, set raw local app DB components (`PGHOST=localhost`, `PGPORT=5432`, `PGDATABASE=andes`, `PGUSER=andes_app`, `PGPASSWORD` from `LOCAL_APP_PASSWORD`), unset `DATABASE_URL`/`PGSSLROOTCERT`/`PGSSLMODE` for local plaintext, and configure `AWS_REGION`, `SQS_EMERGENCY_URL`, `SQS_ORDINARY_URL` and a least-privilege AWS credential chain outside this repository. Run `npm run worker:control` in its own process. That is actual AWS transport usage and may incur charges; it is not the offline demo. Emergency/ordinary processes deliberately refuse startup while `ZAVU_LIVE_SEND=false`. Live delivery needs the separately qualified provider settings before `npm run worker:emergency` and `npm run worker:ordinary` can start. Keep all real provider keys out of test/demo environments.

## Database credential and bootstrap contract

AWS task `Secrets` inject raw username/password JSON components; `Environment` contains only `PGHOST`, `PGPORT`, `PGDATABASE` and `PGSSLROOTCERT` plus nonsecret runtime settings. The shared `databaseConfig()` constructs a URL in memory with each credential component encoded once. The pinned pg driver is checked with reserved characters/Unicode, and the resulting SSL object contains the official CA and `rejectUnauthorized: true`. Connection-string SSL parameters and `PGSSLMODE` are rejected when verified CA configuration is present because the driver would otherwise replace the verified object. Use the real RDS endpoint hostname. Tests prove driver configuration and local PostgreSQL privileges, **not** a real RDS TLS handshake.

Local `DATABASE_URL` remains supported. AWS uses fixed database `andes`; do not put credentials or secret dynamic references into ordinary task `Environment`, command-line overrides or logs. Secret JSON fields are injected with ECS `:json-key::` suffixes on Fargate 1.4.0. Provider secrets must use the AWS-managed Secrets Manager key; custom-key support is not configured.

`AppSecret` generates the `andes_app` credential, but does not itself create a PostgreSQL login. The dedicated `BootstrapTask` uses the RDS-managed administrator secret plus app secret; runtime execution role cannot read that admin secret. `npm run bootstrap` safely creates/updates the app login, runs hash-checked migrations as admin, then grants database CONNECT, schema USAGE, table SELECT/INSERT/UPDATE/DELETE and sequence USAGE/SELECT. It removes PUBLIC schema CREATE, denies writes to `schema_migrations`, and sets migration-owner default grants for future objects. It is retryable and serializes provisioning/migration operations. `npm run migrate` remains available for local admin migrations; on AWS use bootstrap after **every** migration to reapply grants. Runtime cannot create tables or run migrations.

RDS-managed administrator rotation is fetched afresh at each bootstrap launch. App/provider secret injection is a startup snapshot: rotation requires a coordinated SQL-password/provider-secret update and ECS rollout. No application-secret rotation scheduler is implemented. Quiesce services at zero before application password rotation, run bootstrap with the new app secret, then reactivate. Never expose the admin secret to API/control/consumers.

## Future authorized deployment sequence

The commands below are **instructions only; not executed here**. AWS CLI v2 and jq are required. The future operator needs explicit stack/deployment authorization, scoped `RunTask`, task inspection, and `iam:PassRole` for exactly bootstrap task/execution roles with `iam:PassedToService=ecs-tasks.amazonaws.com`; application roles have none of these privileges. Prepare/push the reviewed image to an existing ECR repository and retain its digest; an image build/push is separately authorized work.

1. Copy `infra/parameters.example.json` to ignored `infra/parameters.local.json`; fill every nonsecret account/region/resource input. Keep both enable flags false. Provider secret is optional; if supplied it is a Secrets Manager JSON object with exactly the five named `ZAVU_*` keys in `.env.example` and `docs/contracts/runtime.md`. The qualification JSON is a string value, not a nested secret object. Verify actual evidence before enabling sends. No synthetic evidence is accepted by production loading.
2. Upload the template to an existing private artifact bucket and create a zero-service stack. It exceeds the 51,200-byte inline-template limit, so use S3.

```sh
# Set AWS_REGION, STACK_NAME and ARTIFACT_BUCKET to authorized target values first.
aws s3 cp infra/template.json "s3://$ARTIFACT_BUCKET/andes/template.json"
aws cloudformation create-stack --stack-name "$STACK_NAME" \
  --template-url "https://$ARTIFACT_BUCKET.s3.$AWS_REGION.amazonaws.com/andes/template.json" \
  --parameters file://infra/parameters.local.json --capabilities CAPABILITY_IAM
aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" > infra/stack.local.json
```

3. Run one bootstrap task in the private subnets. Never override credentials/commands at launch.

```sh
umask 077
CLUSTER=$(jq -r '.Stacks[0].Outputs[]|select(.OutputKey=="Cluster")|.OutputValue' infra/stack.local.json)
BOOTSTRAP_TASK=$(jq -r '.Stacks[0].Outputs[]|select(.OutputKey=="BootstrapTaskDefinition")|.OutputValue' infra/stack.local.json)
SUBNET_A=$(jq -r '.Stacks[0].Outputs[]|select(.OutputKey=="PrivateSubnetA")|.OutputValue' infra/stack.local.json)
SUBNET_B=$(jq -r '.Stacks[0].Outputs[]|select(.OutputKey=="PrivateSubnetB")|.OutputValue' infra/stack.local.json)
TASK_GROUP=$(jq -r '.Stacks[0].Outputs[]|select(.OutputKey=="BootstrapSecurityGroup")|.OutputValue' infra/stack.local.json)
jq -n --arg a "$SUBNET_A" --arg b "$SUBNET_B" --arg sg "$TASK_GROUP" \
  '{awsvpcConfiguration:{subnets:[$a,$b],securityGroups:[$sg],assignPublicIp:"DISABLED"}}' > infra/network.local.json
aws ecs run-task --cluster "$CLUSTER" --task-definition "$BOOTSTRAP_TASK" \
  --count 1 --launch-type FARGATE --platform-version 1.4.0 \
  --network-configuration file://infra/network.local.json > infra/bootstrap-run.local.json
jq -e '(.failures|length)==0 and (.tasks|length)==1' infra/bootstrap-run.local.json
TASK_ARN=$(jq -r '.tasks[0].taskArn' infra/bootstrap-run.local.json)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN"
aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" > infra/bootstrap-result.local.json
jq -e '(.failures|length)==0 and (.tasks|length)==1 and
  (.tasks[0].lastStatus=="STOPPED") and
  (.tasks[0].containers|length)==1 and
  (.tasks[0].containers[0].name=="bootstrap") and
  (.tasks[0].containers[0].exitCode==0)' infra/bootstrap-result.local.json
```

STOPPED alone is not success. Stop the deployment sequence at any nonzero command or failed jq assertion; inspect stopped reasons and the redacted `bootstrap` log stream. A task launch failure can return HTTP success with `RunTask.failures`. Never activate after a missing task, startup failure or nonzero container exit.

4. Only after recorded bootstrap success, change `ServicesEnabled` to `true` in the parameter file and use `aws cloudformation update-stack --stack-name "$STACK_NAME" --use-previous-template --parameters file://infra/parameters.local.json --capabilities CAPABILITY_IAM`, then `aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME"`. `/health` currently checks SELECT 1 only: it does **not** certify schema version. Verify OIDC/JWKS, the certified DNS hostname, `/health`, two healthy API tasks and two control tasks before using the API. Do not use manual `ecs update-service --desired-count` to bypass the bootstrap gates.
5. To enable live delivery later, independently verify provider account balance/quotas, sender, destination/country/channel/locale/template and callback evidence, supply the complete provider secret, and set `LiveSendEnabled=true` in a reviewed stack update. That flag changes task definitions and brings two emergency/two ordinary consumers up. Enabling it is real delivery authorization, not a harmless smoke test. For sends-off operation retain the complete provider secret with the flag false to permit read-only reconciliation/callbacks; consumers return to zero.

The template does not verify that your evidence references are true, that networking works, that chosen costs are acceptable, or that an AWS deployment/failover is successful. Record those separately.

## Fixed capacity and monitoring

The API opens at most 10 connections per replica (6 commands + 2 telemetry + 2 callbacks); each worker actually opens at most 2 (unused lazy pools remain unopened). Each enabled service has desired count 2, minimum healthy 100%, maximum deployment 200%; simultaneous rolling replacements can therefore have **four tasks per role**:

`4*10 + 4*2 + 4*2 + 4*2 = 64 runtime connections; +2 bootstrap +14 operations = 80`.

RDS parameter `max_connections=100` leaves another 20 for reserved/internal capacity. Qualify the instance's actual available/reserved connections and memory before activation. No API/worker autoscaler exists. Raising desired counts, pool sizes or rollout percentages requires recalculating this bound first. Two slots per SMS/WhatsApp/voice per delivery task means up to four external requests per class/channel at steady state and eight during a 200% rollout; provider account quotas remain global SQL limits across all replicas. More tasks do not authorize more account traffic. This first capacity is an engineering ceiling, not a throughput/availability/SLA claim.

CloudWatch alarms cover task shortage, unhealthy API targets, RDS connections/storage, source age and DLQ count, with the supplied SNS topic as action. Container Insights is explicitly enabled for real `ECS/ContainerInsights RunningTaskCount`; it carries extra cost. Service-shortage alarms exist only when that service is enabled. Queue age 120 seconds is a synthetic engineering alert bound, not a safety promise. PostgreSQL/RDS exports and 30-day app logs also cost money. No currency quote, credit eligibility, free tier or budget guarantee is asserted. Estimate current target-region Fargate, ALB, Multi-AZ RDS/storage/backups, Secrets Manager, SQS, S3, logs/metrics, existing NAT/egress and provider usage before deployment. No reduced-availability demo mode is configured; reducing replicas or Multi-AZ would explicitly reduce availability.

Unresolved attempts are SQL facts, not an invented CloudWatch custom metric. During operational review, use a secure DB session with `SELECT state,count(*) FROM dispatch_attempts GROUP BY state` and inspect safe hashes/IDs. `unknown` must never be reset to pending for blind resend. Audit phone/location/attempt payload access. No raw sensitive payload belongs in alarms/logs.

## Failures, rollout and rollback

- Migration failure: leave all services at zero; fix the new unapplied migration and rerun bootstrap. Applied migration hashes are immutable; do not edit applied SQL. Test/backup before forward-only schema changes. The bootstrap lock/grants are retryable, not an automatic downgrade tool.
- Deployment failure: circuit breaker rolls services back to the previous task definition. Keep the previous image digest and use a compatible migration/forward repair; never assume app rollback reverses schema. Bootstrap gate and retained state still apply.
- Stop new sends: set live flag false with complete provider secret retained. API advertises no support, delivery service counts become zero; control/callbacks can continue read-only evidence collection. Already authorized/in-flight calls may finish; disabled sending is not provider cancellation. Graceful SIGTERM aborts polling/HTTP but ambiguous authorization remains unknown.
- Queue/provider interruption: SQL scanner restores transport after leases/confirmed-publication delay. Do not redrive a DLQ as a provider retry. Existing `dispatch_attempts.job_id` uniqueness permits one external attempt only; read/callback evidence can settle known message IDs without POST. Unknown IDs may remain unresolved.
- Restore/deletion: test an isolated RDS restore before live use. RDS, app secret, queues, logs and reserved bucket are retained. Retained queues/secrets/data may continue billing and remain operator-owned after stack deletion. Deletion protection must be deliberately reviewed; no destructive cleanup was performed here.
- Live collection still needs qualified core location/raw-draft/audit deletion policies, phone/mobile background tests, Spanish/Brazilian Portuguese/country/provider evidence, callback/recovery/failover/restore tests and human contact UX. Audio/voice interpretation, automatic fatigue/nonresponse escalation and verified human voice-answer semantics are not implemented.

## Evidence limits

CI runs the Node 24 typecheck and build, the PostgreSQL 18 tests, the synthetic process-restart demo, cfn-lint, Compose config validation and the linux/amd64 image build on every push. The template itself has not been deployed. No RDS handshake through the template, alarm delivery, container/AZ interruption or real-device result is claimed.
