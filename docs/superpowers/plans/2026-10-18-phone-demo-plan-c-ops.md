# Phone Demo · Plan C (Operations) Implementation Plan

**Status:** frozen.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Tándem end to end on two physical phones with real Zavu alerts. First run it from this laptop behind a Cloudflare quick tunnel (stage 1), then from the corrected AWS demo deploy (stage 2). Record both runs as evidence and put the AWS URL in the deck and the submission docs.

**Architecture:** This plan changes no product code. Stage 1 runs the API and the `control`, `emergency` and `ordinary` workers locally through one launcher, `scripts/demo-local.sh`, with `HOST=127.0.0.1`. They use the real SQS queues from `deploy.sh prepare` and Postgres from `compose.yaml`, and `cloudflared` exposes them over HTTPS. Stage 2 runs the same image as one ECS Express task through `infra/demo/deploy.sh`, corrected in four ways: it starts the consumers only when `ZAVU_LIVE_SEND=true`, grants them their queue actions, injects six new secrets, and updates the service in place. On the Zavu side there is one sender, «Tándem Demo», and its webhook points at `<public URL>/v1/callbacks/zavu`. Today it carries only `sms_oneway`, so both stages run **SMS-only** and show calls as «No disponible». Buying a voice number is deferred (appendix); nothing in this plan waits on it.

**Tech Stack:** bash (macOS `/bin/bash` 3.2 on the laptop, bash 5 in the container), AWS CLI v2 (SQS, Secrets Manager, IAM, ECR, RDS, ECS Express), Docker Compose with `postgres:18-bookworm`, `cloudflared` quick tunnels, the Zavu REST API through `curl` plus `node` one-liners, and the Node 24 test runner for `tests/infra.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-18-functional-phone-demo-design.md`. This plan covers §9 steps 6–8, the stage 1 and stage 2 parts of §1 with the `deploy.sh` corrections, §5 (env and config), §8 (the two-phone test) and the Risks section.

**Depends on:**
- Plan A (backend) must be merged before Task 7. It provides:
  - serving `web/dist`, `HOST` and `TRUST_PROXY_HOPS`;
  - the OTP endpoints and the `DEMO_*` variables;
  - `smsMode: "oneway"` with the `sms_oneway` → `sms` mapping in sends, reads and callbacks (spec §4);
  - SMS without links (location as text) and calls that read no IDs (spec §4);
  - dropping `allowedDestinations` and `DEMO_LIVE_PHONE` in demo mode;
  - the «Demo de Tándem» prefix validation and the purge.
- Plan B (web) must be merged before Task 7.
- Tasks 1–6 can run in parallel with both.
- If a stage fails because of backend or web behavior, file it against Plan A or B. Do not patch it here.

**GPS packet for Plan B.** `createTripPhoneObservations` (`src/phone-observations/trip-sharing.mjs`) defaults `reviewedContext` to null. `adapter.mjs` `allowed()` stays `unqualified` unless it gets an `andes.phone-observations.qualification/1` packet: `kind: physical-device-review`, `disposition: qualified`, evidence and context refs, the matching budget revision, and `streams.geolocation: true`. Plan C writes that packet from the physical-phone review and hands it to Plan B. GPS stays off until the packet exists; until then the location rows record «sin datos». The CI browser test is not that packet.

**Robert provides or approves (record each answer and its time in chat):**
1. His AWS profile and account. Both are already in `.env`: `AWS_PROFILE=default` and `ANDES_AWS_ACCOUNT=645868669589`. **DECISION PENDING (Robert): keep or remove account ID.**
2. Voice purchase is the appendix. Nothing here waits on it.
3. Go-ahead for each AWS step marked `$` (Task 9).
4. SMS caps: the single table in the spec («Topes de SMS»), **DECISION PENDING (Robert)**. `scripts/demo-local.sh` and the qualification `dailyLimit` / `channelDailyLimit` copy that table. Recommended default: `DEMO_SMS_DAILY_CAP=8` codes/day and 6 alerts per number/day, under Zavu's 25 SMS/day free plan.
5. Two phones. The **contact** phone must have a number whose country is in `DEMO_ALLOWED_COUNTRIES` and that is **not** +1. US and Canadian numbers need 10DLC to receive SMS (`403 ten_dlc_required`).
6. The person holding the contact phone knows it is a test and **will not call 105/190**.

**Cost legend:** `$` marks a step that spends money. It needs Robert's explicit "go" in chat before it runs. Zavu live sends spend balance on every SMS and call, and the caps bound that spend.

**Never print or commit** the Zavu API key, the callback secret, the pepper, DB passwords, demo tokens, the contact link, OTP codes, phone numbers or exact coordinates. The commands below write secrets into the gitignored `.env` without echoing them.

**Conventions.** Run this once per terminal:

```bash
MAIN=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")   # main checkout; .env lives here
set -a; . "$MAIN/.env"; set +a                                              # "load env"
zavu() { if [ -n "${3:-}" ]; then curl -sS -X "$1" "https://api.zavu.dev/v1$2" -H "Authorization: Bearer $ZAVU_API_KEY" -H 'Content-Type: application/json' -d "$3"; else curl -sS -X "$1" "https://api.zavu.dev/v1$2" -H "Authorization: Bearer $ZAVU_API_KEY"; fi; }
pick() { node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")),v=process.argv.slice(1).map(p=>p.split(".").reduce((o,k)=>o?.[k],j));if(v.every(x=>x===undefined)){console.error("unexpected reply: code="+(j?.code??j?.error?.code??"none")+" keys="+Object.keys(j??{}).join(","));process.exit(1)}console.log(v.map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(" "))' "$@"; }
```

`zavu METHOD PATH [JSON]` calls the API without ever printing the key. `pick a.b c` prints the named fields of the JSON reply. If none of them is present, it prints only the error `code` and the reply's top-level keys, then fails. It never prints the whole reply, because replies can carry webhook secrets or tokens. Both helpers work in zsh and bash. Never use `read -p` here: in zsh it means something else. Prompt with `printf` and then `read -r`.

---

## File Structure

| Path | Change | Responsibility |
|---|---|---|
| `scripts/demo-local.sh` | Create (Task 5) | Stage 1 launcher. It loads `.env`, starts the API and three workers on 127.0.0.1 and stops them together |
| `infra/demo/deploy.sh` | Modify (Task 6) | Starts the consumers only with live sends, adds a `delivery-consume` task policy, a `secrets` step with a `demo-secrets` execution policy, the demo environment, update-in-place for `service`, and secrets in `teardown` |
| `tests/infra.test.mjs` | Modify (Task 6) | One test pinning the gate, the IAM actions, the secrets and the demo environment |
| `docs/evidence/phone-run-2026-10-18.md` | Create (Tasks 8, 10) | Evidence: devices, times and results, with an honest scope statement |
| `docs/evidence/phone-run-2026-10-18/*.png` | Create (Tasks 8, 10) | Redacted screenshots only |
| `docs/submission/deck/index.html`, `README.md`, `docs/submission/descripcion.md` | Modify (Task 11) | `DEMO_URL` and the demo and deploy status lines |
| `$MAIN/.env` | Guarded appends, gitignored | Already holds `ZAVU_API_KEY`, `ZAVU_SENDER_ID`, `ZAVU_PROJECT_ID`, `AWS_PROFILE`, `AWS_REGION`, `ANDES_AWS_ACCOUNT` and both `SQS_*_URL`. This plan adds `ZAVU_CALLBACK_SECRET`, `DEMO_PHONE_PEPPER` and the local DB passwords, each only if absent |
| `$MAIN/.env.qualification.json` | Create, gitignored by `.env.*` | `ZAVU_QUALIFICATION_JSON` |
| `<run checkout>/evidence/private/phone-run-2026-10-18/` | Create, gitignored | Raw, unredacted screenshots |

PRs:
- **PR 1** `ops/phone-demo-plan-c` contains Tasks 5 and 6.
- **PR 2** `docs/phone-demo-evidence` contains Tasks 8, 10 and 11.

The reviewer verifies each and Robert merges each.

---

### Task 1: Preflight and local secrets (free)

**Files:** `$MAIN/.env` (append only)

- [ ] **Step 1: Check the tools**

```bash
cloudflared --version; docker compose version; aws --version; node --version; git --version
```

Expected:
- `cloudflared version 2026.x`
- `Docker Compose version v2` or later
- `aws-cli/2.x`
- `v24`–`v26`
- git ≥ 2.31

If `cloudflared` is missing, run `brew install cloudflared`. Also, `~/.cloudflared/config.yml` must not exist, because it can override quick tunnels.

- [ ] **Step 2: Confirm Git ignores the env files**

```bash
git -C "$MAIN" check-ignore -v .env .env.qualification.json
sed -E 's/=.*/=<hidden>/' "$MAIN/.env"
```

Expected: `.gitignore:10:.env	.env` and `.gitignore:11:.env.*	.env.qualification.json`. The names list shows these 8 names, each with a hidden value: `ZAVU_API_KEY`, `ZAVU_SENDER_ID`, `AWS_PROFILE`, `AWS_REGION`, `ANDES_AWS_ACCOUNT`, `SQS_EMERGENCY_URL`, `SQS_ORDINARY_URL` and `ZAVU_PROJECT_ID`.

- [ ] **Step 3: Generate the local-only secrets** (each skipped if already present)

```bash
for var in LOCAL_ADMIN_PASSWORD LOCAL_APP_PASSWORD DEMO_PHONE_PEPPER; do
  grep -q "^$var=" "$MAIN/.env" || printf '%s=%s\n' "$var" "$(openssl rand -hex 32)" >> "$MAIN/.env"
done
sed -E 's/=.*/=<hidden>/' "$MAIN/.env"
```

Expected: 11 names, each appearing once, with every value hidden: the 8 from Step 2 plus `LOCAL_ADMIN_PASSWORD`, `LOCAL_APP_PASSWORD` and `DEMO_PHONE_PEPPER`.

- [ ] **Step 4: Check the AWS profile and account** (skipped if present; they are)

```bash
set -a; . "$MAIN/.env"; set +a
if [ -n "${AWS_PROFILE:-}" ] && [ -n "${ANDES_AWS_ACCOUNT:-}" ]; then
  [ "$(aws sts get-caller-identity --query Account --output text)" = "$ANDES_AWS_ACCOUNT" ] && echo "profile $AWS_PROFILE is account $ANDES_AWS_ACCOUNT" || echo "MISMATCH: stop and ask Robert"
else
  printf 'AWS profile (ask Robert): '; read -r p; printf 'AWS account ID (12 digits, ask Robert): '; read -r a
  [ "$(aws sts get-caller-identity --profile "$p" --query Account --output text)" = "$a" ] \
    && printf 'AWS_PROFILE=%s\nANDES_AWS_ACCOUNT=%s\n' "$p" "$a" >> "$MAIN/.env" && echo saved || echo "profile and account do not match; nothing saved"
fi
grep -q '^AWS_REGION=' "$MAIN/.env" || echo 'AWS_REGION=us-east-1' >> "$MAIN/.env"
```

Expected: `profile default is account 645868669589`. **DECISION PENDING (Robert): keep or remove account ID.** The `else` branch runs only if the values were missing. The account ID is Robert's explicit opt-in, so it is typed in, never derived from the profile. If the session expired, run `aws login` or `aws sso login` first.

---

### Task 2: Zavu account checks (free)

**Files:** `$MAIN/.env` (`ZAVU_PROJECT_ID`, already present)

- [ ] **Step 1 (human, Robert): Read the account limits and decide on «Verify»**

The account today is on the **free plan**, has a **$2 balance** and is **unverified**. Zavu therefore allows **25 SMS a day** across `sms` and `sms_oneway`, and 5 calls a day. The counts reset at 00:00 UTC, which is 19:00 in Lima.

In the dashboard, record for the evidence file:
- the plan;
- the balance;
- the daily ceilings shown;
- the price of one SMS to Peru, after the first code is sent in Task 8.

Then work out how many SMS the $2 buys. At `402 insufficient_balance`, `zavu.ts:86` treats the reply as retryable: alerts retry three times and then end unsent.

**Recommend that Robert runs «Verify»** (identity verification) in the dashboard. It raises the ceilings and does not cost money. If he does, record the new ceilings. Caps change only when he edits the spec SMS table.

The 25 a day are shared by both stages and every judge, while the app's caps apply per database. A full stage 1 run uses 3 SMS (1 code and 2 alerts) and a short stage 2 run uses 2 (1 code and 1 alert). That leaves about 20 for judges on the same UTC day. Zavu's `429 daily_limit_exceeded` is the backstop.

- [ ] **Step 2: Check the project ID** (already in `.env`; it is not a secret)

```bash
grep -q '^ZAVU_PROJECT_ID=' "$MAIN/.env" && echo "ZAVU_PROJECT_ID present" || zavu GET /me | node -e 'const m=JSON.parse(require("fs").readFileSync(0,"utf8")); if (m.isTestMode !== false || !m.project?.id) { console.error("need a live (zv_live_) key; reply keys:", Object.keys(m).join(",")); process.exit(1) } console.log("ZAVU_PROJECT_ID="+m.project.id)' | tee -a "$MAIN/.env"
set -a; . "$MAIN/.env"; set +a
[ "$(zavu GET /me | pick project.id)" = "$ZAVU_PROJECT_ID" ] && echo "matches this API key's project"
```

Expected: `ZAVU_PROJECT_ID present`, then `matches this API key's project`. The backend requires this value to equal the qualification's `accountId` (`src/worker.ts:14`).

- [ ] **Step 3: Read the sender**

```bash
zavu GET "/senders/$ZAVU_SENDER_ID" | pick name channels phoneNumber isDefault webhook.signatureVersion
```

Expected now: `Tándem Demo ["sms_oneway"] undefined true undefined`.

There is no URL-verification step. Zavu verifies each exact URL, so the spec (§4, «Sin links en los SMS») now sends the location in SMS as text («Última ubicación hace {edad} (±{precisión} m): {lat}, {lon}»). Task 7 Step 1 checks that Plan A removed the map link.

---

### Task 3: Deferred

Voice purchase is the appendix. This task does not run. Calls stay «No disponible».

---

### Task 4: Write and validate `ZAVU_QUALIFICATION_JSON` (free)

**Files:** `$MAIN/.env.qualification.json` (gitignored, never committed)

Notes on the values:
- `live` is not in the file: `loadQualification` takes it from `ZAVU_LIVE_SEND` (`src/notifications/zavu.ts:48`).
- `smsMode: "oneway"` is Plan A's option. It sends SMS as `sms_oneway`, which the sender already had before the number.
- There is no `allowedDestinations`, because Plan A drops it in `DEMO_MODE`.
- `demoLimits` 8/8 stays above the spec minimum of 6. SMS caps and `dailyLimit` / `channelDailyLimit` copy the spec table (DECISION PENDING). Recommended: 6, not 100/60.
- The alert body is Spanish only (`src/notifications/wording.ts:15`). The `pt-BR` SMS prefix says so. No voice entries until the appendix.

- [ ] **Step 1: Write the file** (SMS-only)

```bash
set -a; . "$MAIN/.env"; set +a
cat > "$MAIN/.env.qualification.json" <<JSON
{
  "accountId": "$ZAVU_PROJECT_ID",
  "senderId": "$ZAVU_SENDER_ID",
  "evidence": "Zavu project $ZAVU_PROJECT_ID, sender $ZAVU_SENDER_ID (Tándem Demo). 2026-10-18: GET /v1/me isTestMode=false; GET /v1/senders/$ZAVU_SENDER_ID channels include sms_oneway. SMS-only until the voice appendix.",
  "smsMode": "oneway",
  "dailyLimit": 6,
  "channelDailyLimit": 6,
  "minuteLimit": 30,
  "emergencyReserve": 5,
  "demoLimits": { "perIncident": 8, "perSession": 8 },
  "entries": [
    { "country": "PE", "locale": "es", "channel": "sms",
      "text": "Demo de Tándem:",
      "evidence": "2026-10-18: sender $ZAVU_SENDER_ID lists sms_oneway; PE trips; Spanish copy reviewed by Robert." },
    { "country": "PE", "locale": "pt-BR", "channel": "sms",
      "text": "Demo de Tándem (mensagem em espanhol):",
      "evidence": "2026-10-18: sender $ZAVU_SENDER_ID lists sms_oneway; the alert body is Spanish-only (src/notifications/wording.ts), so the prefix says so." }
  ]
}
JSON
```

`dailyLimit` and `channelDailyLimit` copy the spec SMS caps table (recommended 6). `minuteLimit` 30 and `emergencyReserve` 5 are unchanged.

- [ ] **Step 2: Validate it against the real loader**

In any checkout, after `npm ci && npm run build`:

```bash
node --input-type=module -e "
import {readFileSync} from 'node:fs';
import {loadQualification} from './dist/notifications/zavu.js';
const q=loadQualification({ZAVU_LIVE_SEND:'true',ZAVU_QUALIFICATION_JSON:readFileSync(process.argv[1],'utf8')});
const prefix=q.entries.every(e=>e.text===e.text.normalize('NFC')&&e.text.startsWith('Demo de Tándem'));
console.log('ok', q.entries.length, 'entries, live', q.live, ', prefix', prefix, ', demoLimits', JSON.stringify(q.demoLimits), ', allowedDestinations', q.allowedDestinations ?? 'none');
" "$MAIN/.env.qualification.json"
```

Expected: `ok 2 entries, live true , prefix true , demoLimits {"perIncident":8,"perSession":8} , allowedDestinations none`. This was checked against the loader at 23e9f33. `Complete evidenced Zavu qualification required` means the JSON is wrong, so fix the file. Task 7 Step 7 runs the stricter Plan A startup check.

---

### Task 5: `scripts/demo-local.sh` (PR 1)

**Files:**
- Create: `scripts/demo-local.sh`

- [ ] **Step 1: Make the branch**

```bash
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree add -b ops/phone-demo-plan-c "$MAIN/.claude/worktrees/ops-plan-c" origin/main
cd "$MAIN/.claude/worktrees/ops-plan-c"
```

- [ ] **Step 2: Write the launcher**

```bash
#!/usr/bin/env bash
# Phone demo, stage 1: the API plus the control, emergency and ordinary workers on this laptop, with real SQS and real Zavu.
# The API listens on 127.0.0.1 only. Expose it from another terminal: cloudflared tunnel --url http://127.0.0.1:3000
# Secrets come from the main checkout's .env and .env.qualification.json (override with ENV_FILE / QUALIFICATION_FILE).
# Ctrl-C stops all of them; if one exits, the rest are stopped too. ZAVU_LIVE_SEND=false runs only the API and control worker.
# Works with macOS /bin/bash 3.2 (no `wait -n`).
set -euo pipefail
cd "$(dirname "$0")/.."
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
ENV_FILE=${ENV_FILE:-$main/.env}
QUALIFICATION_FILE=${QUALIFICATION_FILE:-$main/.env.qualification.json}
[ -f "$ENV_FILE" ] && [ -f "$QUALIFICATION_FILE" ] || { echo "Missing $ENV_FILE or $QUALIFICATION_FILE" >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
for var in ZAVU_API_KEY ZAVU_PROJECT_ID ZAVU_SENDER_ID ZAVU_CALLBACK_SECRET DEMO_PHONE_PEPPER LOCAL_APP_PASSWORD AWS_PROFILE; do
  [ -n "${!var:-}" ] || { echo "Set $var in $ENV_FILE" >&2; exit 1; }
done
unset DATABASE_URL PGSSLROOTCERT DEMO_LIVE_PHONE
export AWS_REGION=${AWS_REGION:-us-east-1}
SQS_EMERGENCY_URL=$(aws sqs get-queue-url --queue-name andes-demo-emergency --query QueueUrl --output text)
SQS_ORDINARY_URL=$(aws sqs get-queue-url --queue-name andes-demo-ordinary --query QueueUrl --output text)
ZAVU_QUALIFICATION_JSON=$(cat "$QUALIFICATION_FILE")
export SQS_EMERGENCY_URL SQS_ORDINARY_URL ZAVU_QUALIFICATION_JSON
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=andes PGUSER=andes_app PGPASSWORD="$LOCAL_APP_PASSWORD"
export HOST=127.0.0.1 PORT=3000 TRUST_PROXY_HOPS=1 DEMO_MODE=true ZAVU_LIVE_SEND=${ZAVU_LIVE_SEND:-true}
# Same demo values as infra/demo/deploy.sh `service` (spec §5). SMS caps copy the spec table (DECISION PENDING). Recommended: 8 codes/day, 6 alerts/number/day.
export DEMO_ALLOWED_COUNTRIES=${DEMO_ALLOWED_COUNTRIES:-PE,BR,CL,CO,MX,AR} DEMO_OTP_PER_NUMBER_HOURLY=${DEMO_OTP_PER_NUMBER_HOURLY:-3}
export DEMO_OTP_PER_IP_HOURLY=${DEMO_OTP_PER_IP_HOURLY:-5} DEMO_SMS_DAILY_CAP=${DEMO_SMS_DAILY_CAP:-8} DEMO_ALERTS_PER_NUMBER_DAILY=${DEMO_ALERTS_PER_NUMBER_DAILY:-6}
export SILENCE_MS=120000 ASK_GRACE_MS=60000 ARRIVAL_GRACE_MS=120000 CHECK_SWEEP_MS=5000
export EMERGENCY_NUMBERS='{"PE":"105","BR":"190"}' INSIGHTS_TIME_ZONE=America/Lima
npm run build >/dev/null
npm --prefix web run build >/dev/null
pids=()
trap '[ ${#pids[@]} -eq 0 ] || kill "${pids[@]}" 2>/dev/null; wait' EXIT
trap 'exit 130' INT TERM
for role in control emergency ordinary; do
  [ "$role" = control ] || [ "$ZAVU_LIVE_SEND" = true ] || continue
  node dist/worker.js "$role" & pids+=($!)
done
node dist/server.js & pids+=($!)
echo "API on http://127.0.0.1:3000 with ${#pids[@]} processes (ZAVU_LIVE_SEND=$ZAVU_LIVE_SEND). Ctrl-C stops them all."
while :; do for pid in "${pids[@]}"; do kill -0 "$pid" 2>/dev/null || break 2; done; sleep 2; done
echo "A process exited; stopping the rest." >&2
exit 1
```

How it behaves:
- **Liveness:** it checks each pid on its own, because bash's `kill -0 a b` succeeds if *any* process is alive.
- **Consumer gate:** it skips the consumers when sends are off, the same gate as the deploy.
- **`CONTACT_APP_URL`:** left unset on purpose. It would add `Ver: <url>/incidents/<id>` (`wording.ts:28`), a route the spec's web app does not have, and one more URL for Zavu to verify.

- [ ] **Step 3: Offline checks**

```bash
chmod +x scripts/demo-local.sh
/bin/bash -n scripts/demo-local.sh && echo syntax-ok
ENV_FILE=/nonexistent scripts/demo-local.sh; echo "exit $?"
```

Expected: `syntax-ok`, then `Missing /nonexistent or …/.env.qualification.json`, then `exit 1`. With stub `aws`, `npm` and `node` on `PATH`, the script was dry-run under `/bin/bash` 3.2. It started 4 processes with live sends and 2 without. When one process exited, it stopped the rest and exited 1. Ctrl-C exited 130. Task 7 does the real run.

- [ ] **Step 4: Commit**

```bash
git add scripts/demo-local.sh
git commit -m "feat(ops): Add the local phone-demo launcher for the tunnel stage"
```

---

### Task 6: Correct `infra/demo/deploy.sh` and pin it with an infra test (PR 1)

**Files:**
- Modify: `tests/infra.test.mjs` (append one test)
- Modify: `infra/demo/deploy.sh` (full replacement below)

- [ ] **Step 1: Write the failing test.** Append to `tests/infra.test.mjs`:

```js

test('demo deploy: consumers only with live sends, their queue actions, every demo secret and the demo environment',()=>{
  const deploy=text('infra/demo/deploy.sh').replace(/\s*\\\n\s*/g,' ');
  // With ZAVU_LIVE_SEND=false startWorker refuses the consumers; ungated, `wait -n; exit 1` would restart the whole task, API included.
  assert.ok(deploy.includes('"command":["bash","-c","node dist/worker.js control & if [ \\"\\$ZAVU_LIVE_SEND\\" = true ]; then node dist/worker.js emergency & node dist/worker.js ordinary & fi; node dist/server.js & wait -n; exit 1"]'));
  for(const role of ['emergency','ordinary'])assert.equal(deploy.split(`node dist/worker.js ${role}`).length,2,`${role} starts only inside the gate`);
  assert.ok(deploy.includes('LIVE="${ZAVU_LIVE_SEND:-false}"')&&deploy.includes('{"name":"ZAVU_LIVE_SEND","value":"$LIVE"}'));
  const task=deploy.split('\n').filter(line=>line.includes('put-role-policy --role-name "$N-task"')).join('\n');
  for(const action of ['sqs:SendMessage','sqs:ReceiveMessage','sqs:DeleteMessage','sqs:ChangeMessageVisibility'])assert.ok(task.includes(`\\"${action}\\"`),action);
  assert.equal(task.split('\\"$(queue_arn emergency)\\",\\"$(queue_arn ordinary)\\"').length,3,'both task policies cover both queues');
  const secrets=deploy.match(/^SECRETS="([^"]+)"$/m)[1].split(' ').map(pair=>pair.split(':')[1]).sort();
  assert.deepEqual(secrets,['DEMO_PHONE_PEPPER','ZAVU_API_KEY','ZAVU_CALLBACK_SECRET','ZAVU_PROJECT_ID','ZAVU_QUALIFICATION_JSON','ZAVU_SENDER_ID']);
  // The execution role must read every injected secret, or the task never starts.
  assert.match(deploy,/secret_arns\(\) \{ for pair in \$SECRETS;/);
  assert.match(deploy,/--role-name "\$N-exec" --policy-name demo-secrets --policy-document "[^\n]*secretsmanager:GetSecretValue[^\n]*\[\$\(secret_arns\)\]/);
  assert.match(deploy,/service_secrets\(\) \{ for pair in app-db:PGPASSWORD \$SECRETS;/);
  assert.ok(deploy.includes('"secrets":[$(service_secrets)]'));
  for(const name of ['DEMO_MODE','TRUST_PROXY_HOPS','DEMO_ALLOWED_COUNTRIES','DEMO_OTP_PER_NUMBER_HOURLY','DEMO_OTP_PER_IP_HOURLY','DEMO_SMS_DAILY_CAP','DEMO_ALERTS_PER_NUMBER_DAILY','SILENCE_MS','ASK_GRACE_MS','ARRIVAL_GRACE_MS','CHECK_SWEEP_MS','EMERGENCY_NUMBERS'])assert.ok(deploy.includes(`{"name":"${name}"`),name);
  assert.ok(deploy.includes('{"name":"TRUST_PROXY_HOPS","value":"1"}'));
  // Migrations run in bootstrap, which must come before lock: afterwards the laptop cannot reach RDS.
  assert.ok(deploy.includes('prepare|secrets|image|database|bootstrap|lock|service|url|teardown'));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run infra:check
```

Expected: `ℹ pass 6`, `ℹ fail 1`. The failure is the new test's first assertion, the gated command.

- [ ] **Step 3: Replace `infra/demo/deploy.sh` with:**

```bash
#!/usr/bin/env bash
# Judges' demo on ECS Express Mode: one Fargate task (API, control loop and, with live sends, both delivery consumers), RDS PostgreSQL, two SQS queues.
# A "demo reducida" (single task, single AZ), not the ADR-002 HA deployment in infra/template.json.
# Run one step at a time; steps marked $ cost money. Usage: AWS_PROFILE=<personal> ANDES_AWS_ACCOUNT=<its id> infra/demo/deploy.sh <step>
# Order: prepare, secrets, image, database, bootstrap (applies migrations: re-run it for new ones, always before lock), lock, service, url.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${AWS_PROFILE:?Set AWS_PROFILE to your personal account profile}"
: "${ANDES_AWS_ACCOUNT:?Set ANDES_AWS_ACCOUNT to the account ID you intend to deploy into}"
export AWS_REGION="${AWS_REGION:-us-east-1}" AWS_PAGER=""
N=andes-demo
TAGS="Key=project,Value=andes-hackathon"
# <Secrets Manager name under $N/>:<variable the task receives>. `secrets` stores each value from this shell's environment.
SECRETS="zavu-api-key:ZAVU_API_KEY zavu-callback-secret:ZAVU_CALLBACK_SECRET zavu-qualification:ZAVU_QUALIFICATION_JSON demo-phone-pepper:DEMO_PHONE_PEPPER zavu-project-id:ZAVU_PROJECT_ID zavu-sender-id:ZAVU_SENDER_ID"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
# Explicit opt-in per account: a wrong or default profile cannot deploy (or tear down) anything.
[ "$ACCOUNT" = "$ANDES_AWS_ACCOUNT" ] || { echo "Refusing: profile account $ACCOUNT is not ANDES_AWS_ACCOUNT" >&2; exit 1; }
REPO="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$N"
queue_url() { aws sqs get-queue-url --queue-name "$N-$1" --query QueueUrl --output text; }
queue_arn() { aws sqs get-queue-attributes --queue-url "$(queue_url "$1")" --attribute-names QueueArn --query Attributes.QueueArn --output text; }
secret_arn() { aws secretsmanager describe-secret --secret-id "$1" --query ARN --output text; }
secret_arns() { for pair in $SECRETS; do printf '"%s",' "$(secret_arn "$N/${pair%%:*}")"; done | sed 's/,$//'; }
service_secrets() { for pair in app-db:PGPASSWORD $SECRETS; do printf '{"name":"%s","valueFrom":"%s"},' "${pair#*:}" "$(secret_arn "$N/${pair%%:*}")"; done | sed 's/,$//'; }
db() { aws rds describe-db-instances --db-instance-identifier "$N" --query "DBInstances[0].$1" --output text; }
vpc() { aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text; }
subnets() { aws ec2 describe-subnets --filters Name=vpc-id,Values="$(vpc)" Name=availability-zone,Values="${AWS_REGION}a,${AWS_REGION}b" --query 'Subnets[].SubnetId' --output text; }
db_sg() { aws ec2 describe-security-groups --filters Name=group-name,Values="$N-db" Name=vpc-id,Values="$(vpc)" --query 'SecurityGroups[0].GroupId' --output text; }
my_ip() { curl -fsS https://checkip.amazonaws.com | tr -d '\n'; }
role() { # name trust-service [managed-policy-arn]
  aws iam get-role --role-name "$1" >/dev/null 2>&1 || aws iam create-role --role-name "$1" --tags "$TAGS" \
    --assume-role-policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
  [ -z "${3:-}" ] || aws iam attach-role-policy --role-name "$1" --policy-arn "$3"
}

case "${1:-}" in
prepare) # free: roles, queues, image repository, app DB secret, log group, cluster
  for q in emergency ordinary; do aws sqs create-queue --queue-name "$N-$q" --tags project=andes-hackathon >/dev/null; done
  aws ecr describe-repositories --repository-names "$N" >/dev/null 2>&1 || aws ecr create-repository --repository-name "$N" --tags "$TAGS" >/dev/null
  aws secretsmanager describe-secret --secret-id "$N/app-db" >/dev/null 2>&1 || aws secretsmanager create-secret --name "$N/app-db" --tags "$TAGS" \
    --secret-string "$(openssl rand -hex 24)" >/dev/null
  aws logs create-log-group --log-group-name "/ecs/$N" --tags project=andes-hackathon 2>/dev/null || true
  aws ecs create-cluster --cluster-name "$N" --tags key=project,value=andes-hackathon >/dev/null
  role "$N-exec" ecs-tasks.amazonaws.com arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  aws iam put-role-policy --role-name "$N-exec" --policy-name app-db-secret --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"$(secret_arn "$N/app-db")\"}]}"
  role "$N-task" ecs-tasks.amazonaws.com
  aws iam put-role-policy --role-name "$N-task" --policy-name control-send --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sqs:SendMessage\",\"Resource\":[\"$(queue_arn emergency)\",\"$(queue_arn ordinary)\"]}]}"
  aws iam put-role-policy --role-name "$N-task" --policy-name delivery-consume --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"sqs:ReceiveMessage\",\"sqs:DeleteMessage\",\"sqs:ChangeMessageVisibility\"],\"Resource\":[\"$(queue_arn emergency)\",\"$(queue_arn ordinary)\"]}]}"
  role ecsInfrastructureRoleForExpressServices ecs.amazonaws.com arn:aws:iam::aws:policy/service-role/AmazonECSInfrastructureRoleforExpressGatewayServices
  echo "prepared in $ACCOUNT/$AWS_REGION" ;;
secrets) # $ ~0.40/month per secret: the six Zavu/demo secrets, read from this shell (load .env and ZAVU_QUALIFICATION_JSON first)
  for pair in $SECRETS; do
    id="$N/${pair%%:*}" var="${pair#*:}"; : "${!var:?Set $var in this shell}"
    # Values go through stdin, never the command line, so they never show in the process list.
    if aws secretsmanager describe-secret --secret-id "$id" >/dev/null 2>&1; then printf %s "${!var}" | aws secretsmanager put-secret-value --secret-id "$id" --secret-string file:///dev/stdin >/dev/null
    else printf %s "${!var}" | aws secretsmanager create-secret --name "$id" --tags "$TAGS" --secret-string file:///dev/stdin >/dev/null; fi
  done
  aws iam put-role-policy --role-name "$N-exec" --policy-name demo-secrets --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":[$(secret_arns)]}]}"
  echo "stored $(echo $SECRETS | wc -w | tr -d ' ') secrets" ;;
image) # free (ECR storage ~cents): build x86_64 image and push
  aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%/*}"
  docker buildx build --platform linux/amd64 -t "$REPO:latest" --push .
  aws ecr describe-images --repository-name "$N" --image-ids imageTag=latest --query 'imageDetails[0].imageDigest' --output text ;;
database) # $ ~0.45/day: db.t4g.micro single-AZ PostgreSQL 18.3, reachable from the VPC and, until `lock`, this laptop
  sg=$(db_sg); if [ "$sg" = "None" ]; then
    sg=$(aws ec2 create-security-group --group-name "$N-db" --description "ANDES demo database" --vpc-id "$(vpc)" --query GroupId --output text)
    aws ec2 authorize-security-group-ingress --group-id "$sg" --protocol tcp --port 5432 --cidr "$(aws ec2 describe-vpcs --vpc-ids "$(vpc)" --query 'Vpcs[0].CidrBlock' --output text)" >/dev/null
  fi
  aws ec2 authorize-security-group-ingress --group-id "$sg" --protocol tcp --port 5432 --cidr "$(my_ip)/32" >/dev/null 2>&1 || true
  aws rds create-db-instance --db-instance-identifier "$N" --engine postgres --engine-version 18.3 --db-instance-class db.t4g.micro \
    --allocated-storage 20 --storage-type gp3 --storage-encrypted --no-multi-az --backup-retention-period 1 --db-name andes \
    --master-username andes_admin --manage-master-user-password --vpc-security-group-ids "$sg" --publicly-accessible --tags "$TAGS" >/dev/null
  aws rds wait db-instance-available --db-instance-identifier "$N"; db Endpoint.Address ;;
bootstrap) # free: app login, migrations and demo seed, from this laptop while `database` left it reachable
  # A fresh database has no stale active trips; on a reused one, cancel old trips before enabling checks or each will escalate.
  npm run build >/dev/null
  admin=$(aws secretsmanager get-secret-value --secret-id "$(db MasterUserSecret.SecretArn)" --query SecretString --output text)
  export PGHOST=$(db Endpoint.Address) PGPORT=5432 PGDATABASE=andes PGSSLROOTCERT=infra/rds-global-bundle.pem
  PGUSER=andes_admin PGPASSWORD=$(node -p 'JSON.parse(process.argv[1]).password' "$admin") APP_PGUSER=andes_app \
    APP_PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id "$N/app-db" --query SecretString --output text) node scripts/bootstrap.mjs
  if [ -f scripts/seed-demo.mjs ]; then PGUSER=andes_app PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id "$N/app-db" --query SecretString --output text) SEED_DEMO=1 node scripts/seed-demo.mjs; fi ;;
lock) # free: remove laptop access and public reachability once bootstrap is done
  aws ec2 revoke-security-group-ingress --group-id "$(db_sg)" --protocol tcp --port 5432 --cidr "$(my_ip)/32" >/dev/null || true
  aws rds modify-db-instance --db-instance-identifier "$N" --no-publicly-accessible --apply-immediately >/dev/null; echo locked ;;
service) # $ ~1.5/day: Fargate 0.5 vCPU/1 GB + Express-managed HTTPS load balancer. Re-run to roll out new settings.
  # ZAVU_LIVE_SEND=true (default false) turns real sends on. With it off the container skips the consumers: startWorker
  # refuses them without a live provider, and under `wait -n; exit 1` that would restart the whole task, API included.
  LIVE="${ZAVU_LIVE_SEND:-false}"
  cat > /tmp/$N-service.json <<JSON
{"serviceName":"$N","cluster":"$N","healthCheckPath":"/health","cpu":"512","memory":"1024",
 "executionRoleArn":"arn:aws:iam::$ACCOUNT:role/$N-exec","taskRoleArn":"arn:aws:iam::$ACCOUNT:role/$N-task",
 "infrastructureRoleArn":"arn:aws:iam::$ACCOUNT:role/ecsInfrastructureRoleForExpressServices",
 "networkConfiguration":{"subnets":[$(subnets | sed 's/\([^[:space:]]*\)/"\1"/g; s/[[:space:]]\{1,\}/,/g')]},
 "scalingTarget":{"minTaskCount":1,"maxTaskCount":1},
 "tags":[{"key":"project","value":"andes-hackathon"}],
 "primaryContainer":{"image":"$REPO:latest","containerPort":3000,
  "awsLogsConfiguration":{"logGroup":"/ecs/$N","logStreamPrefix":"app"},
  "command":["bash","-c","node dist/worker.js control & if [ \"\$ZAVU_LIVE_SEND\" = true ]; then node dist/worker.js emergency & node dist/worker.js ordinary & fi; node dist/server.js & wait -n; exit 1"],
  "secrets":[$(service_secrets)],
  "environment":[{"name":"PORT","value":"3000"},{"name":"PGHOST","value":"$(db Endpoint.Address)"},{"name":"PGPORT","value":"5432"},
   {"name":"PGDATABASE","value":"andes"},{"name":"PGUSER","value":"andes_app"},{"name":"PGSSLROOTCERT","value":"/app/infra/rds-global-bundle.pem"},
   {"name":"AWS_REGION","value":"$AWS_REGION"},{"name":"SQS_EMERGENCY_URL","value":"$(queue_url emergency)"},{"name":"SQS_ORDINARY_URL","value":"$(queue_url ordinary)"},
   {"name":"ZAVU_LIVE_SEND","value":"$LIVE"},{"name":"DEMO_MODE","value":"true"},{"name":"TRUST_PROXY_HOPS","value":"1"},
   {"name":"DEMO_ALLOWED_COUNTRIES","value":"${DEMO_ALLOWED_COUNTRIES:-PE,BR,CL,CO,MX,AR}"},{"name":"DEMO_OTP_PER_NUMBER_HOURLY","value":"${DEMO_OTP_PER_NUMBER_HOURLY:-3}"},
   {"name":"DEMO_OTP_PER_IP_HOURLY","value":"${DEMO_OTP_PER_IP_HOURLY:-5}"},{"name":"DEMO_SMS_DAILY_CAP","value":"${DEMO_SMS_DAILY_CAP:-8}"},
   {"name":"DEMO_ALERTS_PER_NUMBER_DAILY","value":"${DEMO_ALERTS_PER_NUMBER_DAILY:-6}"},
   {"name":"SILENCE_MS","value":"120000"},{"name":"ASK_GRACE_MS","value":"60000"},{"name":"ARRIVAL_GRACE_MS","value":"120000"},{"name":"CHECK_SWEEP_MS","value":"5000"},
   {"name":"EMERGENCY_NUMBERS","value":"{\"PE\":\"105\",\"BR\":\"190\"}"},{"name":"INSIGHTS_TIME_ZONE","value":"America/Lima"}]}}
JSON
  arn=$(aws ecs list-services --cluster "$N" --query 'serviceArns[0]' --output text)
  if [ "$arn" = None ]; then aws ecs create-express-gateway-service --cli-input-json "file:///tmp/$N-service.json" --query 'service.serviceArn' --output text
  else aws ecs update-express-gateway-service --service-arn "$arn" --primary-container "$(node -p 'JSON.stringify(require(process.argv[1]).primaryContainer)' "/tmp/$N-service.json")" >/dev/null; echo "updated $arn"; fi ;;
url) # free
  arn=$(aws ecs list-services --cluster "$N" --query 'serviceArns[0]' --output text)
  aws ecs describe-express-gateway-service --service-arn "$arn" --output json | node -e 'const s=JSON.parse(require("fs").readFileSync(0));console.log(JSON.stringify(s,null,1).match(/"endpoint": "([^"]+)"/)?.[1] ?? JSON.stringify(s.service?.status ?? s))' ;;
teardown) # stops all charges; deletes demo data
  arn=$(aws ecs list-services --cluster "$N" --query 'serviceArns[0]' --output text 2>/dev/null || echo None)
  [ "$arn" = "None" ] || aws ecs delete-express-gateway-service --service-arn "$arn" >/dev/null || true
  aws rds delete-db-instance --db-instance-identifier "$N" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || true
  for q in emergency ordinary; do aws sqs delete-queue --queue-url "$(queue_url $q)" 2>/dev/null || true; done
  aws ecr delete-repository --repository-name "$N" --force >/dev/null 2>&1 || true
  for pair in app-db:PGPASSWORD $SECRETS; do aws secretsmanager delete-secret --secret-id "$N/${pair%%:*}" --force-delete-without-recovery >/dev/null 2>&1 || true; done
  echo "Deleting; the database security group, roles, cluster and log group are free and can be removed after RDS is gone." ;;
*) echo "usage: AWS_PROFILE=<profile> ANDES_AWS_ACCOUNT=<id> $0 prepare|secrets|image|database|bootstrap|lock|service|url|teardown" >&2; exit 2 ;;
esac
```

What changed from 23e9f33:
- The `delivery-consume` task policy, added rather than renamed, so `control-send` stays as it is.
- The `secrets` step and its `demo-secrets` execution policy.
- The gated command, the six secrets and the `DEMO_*` and `TRUST_PROXY_HOPS` environment.
- `ZAVU_LIVE_SEND` comes from the shell, defaulting to `false`.
- `service` updates in place when the service exists. That is how the kill switch flips, and how new settings roll out.
- `teardown` deletes the new secrets.

- [ ] **Step 4: Run the tests and syntax check**

```bash
npm run infra:check && bash -n infra/demo/deploy.sh && echo syntax-ok
```

Expected: `ℹ pass 7`, `ℹ fail 0`, `syntax-ok`.

- [ ] **Step 5: Render the service JSON offline with a stub `aws`**

```bash
stub=$(mktemp -d); cat > "$stub/aws" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"sts get-caller-identity"*) echo 123456789012 ;;
  *"list-services"*) echo None ;;
  *"describe-secret"*"--query ARN"*) echo "arn:aws:secretsmanager:us-east-1:123456789012:secret:$4-AbCdEf" ;;
  *"create-express-gateway-service"*) echo arn:aws:ecs:stub:service/andes-demo ;;
  *) echo stub ;;
esac
SH
chmod +x "$stub/aws"
PATH="$stub:$PATH" AWS_PROFILE=stub ANDES_AWS_ACCOUNT=123456789012 ZAVU_LIVE_SEND=true infra/demo/deploy.sh service
node -e 'const c=require("/tmp/andes-demo-service.json").primaryContainer; console.log(c.command[2]); console.log(c.secrets.map(x=>x.name).join(",")); console.log(c.environment.filter(e=>/ZAVU|DEMO|TRUST/.test(e.name)).map(e=>e.name+"="+e.value).join(" "))'
PATH="$stub:$PATH" AWS_PROFILE=stub ANDES_AWS_ACCOUNT=123456789012 infra/demo/deploy.sh service >/dev/null && node -p 'require("/tmp/andes-demo-service.json").primaryContainer.environment.find(e=>e.name==="ZAVU_LIVE_SEND").value'
rm -rf "$stub" /tmp/andes-demo-service.json
```

Expected:

```
arn:aws:ecs:stub:service/andes-demo
node dist/worker.js control & if [ "$ZAVU_LIVE_SEND" = true ]; then node dist/worker.js emergency & node dist/worker.js ordinary & fi; node dist/server.js & wait -n; exit 1
PGPASSWORD,ZAVU_API_KEY,ZAVU_CALLBACK_SECRET,ZAVU_QUALIFICATION_JSON,DEMO_PHONE_PEPPER,ZAVU_PROJECT_ID,ZAVU_SENDER_ID
ZAVU_LIVE_SEND=true DEMO_MODE=true TRUST_PROXY_HOPS=1 DEMO_ALLOWED_COUNTRIES=PE,BR,CL,CO,MX,AR DEMO_OTP_PER_NUMBER_HOURLY=3 DEMO_OTP_PER_IP_HOURLY=5 DEMO_SMS_DAILY_CAP=8 DEMO_ALERTS_PER_NUMBER_DAILY=6
false
```

The plan author ran exactly this. The update branch was also checked: it hands `update-express-gateway-service` valid `primaryContainer` JSON.

- [ ] **Step 6: Mutation checks** (each must turn the test red; restore after each)

```bash
cp infra/demo/deploy.sh /tmp/deploy.good
m() { npm run infra:check 2>&1 | grep -E '^ℹ fail'; cp /tmp/deploy.good infra/demo/deploy.sh; }
sed -i '' 's|if \[ \\"\\$ZAVU_LIVE_SEND\\" = true \]; then node dist/worker.js emergency \& node dist/worker.js ordinary \& fi; |node dist/worker.js emergency \& node dist/worker.js ordinary \& |' infra/demo/deploy.sh; m
sed -i '' 's|,\\"sqs:ChangeMessageVisibility\\"||' infra/demo/deploy.sh; m
sed -i '' 's| demo-phone-pepper:DEMO_PHONE_PEPPER||' infra/demo/deploy.sh; m
sed -i '' 's|{"name":"ZAVU_LIVE_SEND","value":"\$LIVE"}|{"name":"ZAVU_LIVE_SEND","value":"false"}|' infra/demo/deploy.sh; m
sed -i '' 's|,{"name":"TRUST_PROXY_HOPS","value":"1"}||' infra/demo/deploy.sh; m
git diff --stat infra/demo/deploy.sh
```

Expected: five lines of `ℹ fail 1`, then a diff stat that matches Step 3, which shows every mutation was restored.

- [ ] **Step 7: Commit and open PR 1**

```bash
git add infra/demo/deploy.sh tests/infra.test.mjs
git commit -m "fix(infra): Run the delivery consumers only with live sends and grant their queue and secret access"
git push -u origin ops/phone-demo-plan-c
gh pr create --base main --title "ops: phone-demo launcher and demo deploy corrections (Plan C)" --body "Implements tasks 5–6 of docs/superpowers/plans/2026-10-18-phone-demo-plan-c-ops.md: scripts/demo-local.sh for the tunnel stage; infra/demo/deploy.sh runs the consumers only with ZAVU_LIVE_SEND=true, grants Receive/Delete/ChangeMessageVisibility, injects six secrets with GetSecretValue for each, adds the demo environment and updates the service in place. tests/infra.test.mjs pins all of it (5 mutations turn it red). Nothing was deployed."
```

Robert merges. Do not merge it yourself.

---

### Task 7: Stage 1, bring the stack up behind the tunnel (free, except live sends)

**Precondition:** Plans A and B and PR 1 are merged into `main`.

**Files:** none committed

- [ ] **Step 1: Make a clean run checkout** (Robert's main checkout has unrelated local changes; leave it alone)

```bash
git -C "$MAIN" fetch origin
git -C "$MAIN" worktree add --detach "$MAIN/.claude/worktrees/phone-demo-run" origin/main
RUN="$MAIN/.claude/worktrees/phone-demo-run"; cd "$RUN"
npm ci && npm --prefix web ci
git log --oneline -1
grep -rq smsMode src && grep -rq TRUST_PROXY_HOPS src && grep -rq demo_phone_verifications db/migrations && grep -q 'dist/worker.js emergency' infra/demo/deploy.sh && echo "A, B and C merged"
```

Expected: the commit line, then `A, B and C merged`. If that line does not appear, stop: a dependency is missing.

- [ ] **Step 2: Start Postgres**

```bash
set -a; . "$MAIN/.env"; set +a
docker compose up -d db && docker compose ps db
```

Expected: `db` is `running (healthy)` on `127.0.0.1:5432`. If an old `postgres` volume from this directory has another password, run `docker compose down -v`. That deletes local synthetic data only.

- [ ] **Step 3: Bootstrap, migrate and seed**

```bash
npm run build >/dev/null
export PGHOST=127.0.0.1 PGPORT=5432 PGDATABASE=andes
PGUSER=andes_admin PGPASSWORD="$LOCAL_ADMIN_PASSWORD" APP_PGUSER=andes_app APP_PGPASSWORD="$LOCAL_APP_PASSWORD" node scripts/bootstrap.mjs
PGUSER=andes_app PGPASSWORD="$LOCAL_APP_PASSWORD" SEED_DEMO=1 node scripts/seed-demo.mjs
```

Expected: `Database bootstrap and migrations applied` and `Seeded 40 synthetic reports`. After pulling new migrations later, run `PGUSER=andes_admin PGPASSWORD="$LOCAL_ADMIN_PASSWORD" node scripts/migrate.mjs`, which should print `Migrations applied`. The bootstrap's default privileges give `andes_app` access to tables `andes_admin` creates later.

- [ ] **Step 4: Create the real queues** (free; needs `AWS_PROFILE` and `ANDES_AWS_ACCOUNT`)

```bash
infra/demo/deploy.sh prepare
```

Expected: `prepared in <account>/us-east-1`. Local workers then use Robert's profile for SQS. In AWS, the task role does that job.

- [ ] **Step 5: Start the tunnel** (terminal 2; keep it open)

```bash
cloudflared tunnel --url http://127.0.0.1:3000 2>&1 | tee /tmp/cloudflared.log
```

In terminal 1:

```bash
PUBLIC=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /tmp/cloudflared.log | head -1); echo "$PUBLIC"
```

Expected: `https://<words>.trycloudflare.com`. It returns 502 until the API starts. Every `cloudflared` restart gives a new URL, so repeat Step 6's PATCH after one.

- [ ] **Step 6: Point the Zavu webhook at the tunnel and get its secret**

```bash
zavu PATCH "/senders/$ZAVU_SENDER_ID" "{\"webhookUrl\":\"$PUBLIC/v1/callbacks/zavu\",\"webhookEvents\":[\"message.queued\",\"message.sent\",\"message.delivered\",\"message.failed\"],\"webhookActive\":true,\"webhookSignatureVersion\":\"v2\"}" \
  | pick webhook.url webhook.events webhook.active webhook.signatureVersion
```

Expected: `https://….trycloudflare.com/v1/callbacks/zavu ["message.queued","message.sent","message.delivered","message.failed"] true v2`.
- If the reply is a 400 about the signature version (the sender was on `v1`), send the same body with `"v1+v2"`. The backend reads only `t` and `v2` (`zavu.ts:110`).
- Do not subscribe to `message.inbound`. Its payload fails `verifyCallback`, so Zavu would retry it five times.

```bash
grep -q '^ZAVU_CALLBACK_SECRET=' "$MAIN/.env" || zavu POST "/senders/$ZAVU_SENDER_ID/webhook/secret" | pick secret | sed 's/^/ZAVU_CALLBACK_SECRET=/' >> "$MAIN/.env"
grep -c '^ZAVU_CALLBACK_SECRET=' "$MAIN/.env"
```

Expected: `1`. Regenerating invalidates the old secret at once. Never regenerate it again unless you also update `.env` and, once AWS is up, re-run `deploy.sh secrets` and `service`.

- [ ] **Step 7: Startup check with the merged backend**

```bash
( set -a; . "$MAIN/.env"; set +a
  export ZAVU_LIVE_SEND=true DEMO_MODE=true DEMO_SMS_DAILY_CAP=8 DEMO_ALERTS_PER_NUMBER_DAILY=6 ZAVU_QUALIFICATION_JSON="$(cat "$MAIN/.env.qualification.json")"
  node --input-type=module -e "import {configuredProvider} from './dist/worker.js'; const p=configuredProvider(process.env); console.log('provider ok, live', p.qualification.live, ', entries', p.qualification.entries.length)" )
```

Expected: `provider ok, live true , entries 2`. Any thrown message names the missing or mismatched setting, such as the callback project or sender, the prefix, `demoLimits` or the caps.

- [ ] **Step 8: Launch** (terminal 3; keep it open)

```bash
cd "$RUN" && scripts/demo-local.sh
```

Expected: `API on http://127.0.0.1:3000 with 4 processes (ZAVU_LIVE_SEND=true). Ctrl-C stops them all.` If a process exits, the script prints `A process exited; stopping the rest.` In that case, read the error line above it.

- [ ] **Step 9: Local checks** (terminal 1)

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN | tail -n +2
curl -fsS http://127.0.0.1:3000/health; echo
```

Expected: one `node` line with `127.0.0.1:3000 (LISTEN)`, not `*:3000`, then `{"status":"ok"}`.

- [ ] **Step 10: Smoke test through the tunnel**

```bash
curl -fsS "$PUBLIC/health"; echo
curl -fsS "$PUBLIC/" | grep -c '<div id="root"></div>'
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "$PUBLIC/trips/00000000-0000-4000-8000-000000000000"
curl -sS -w ' %{http_code}\n' "$PUBLIC/v1/trips/00000000-0000-4000-8000-000000000000/status"
curl -sS -w ' %{http_code}\n' -X POST "$PUBLIC/v1/callbacks/zavu" -H 'content-type: application/json' -d '{}'
curl -sS -o /dev/null -w '%{http_code}\n' "$PUBLIC/mapa"
curl -sS -X POST "$PUBLIC/v1/demo/session" -H 'content-type: application/json' -d '{}' | pick synthetic tripCountries driver.truckId family.grantId
```

Expected, in order:
1. `{"status":"ok"}`
2. `1`
3. `200 text/html…` (the SPA fallback)
4. `{"code":"unauthorized"} 401`
5. `{"code":"invalid_callback"} 401` (the callback route is registered)
6. `200`
7. `true ["PE"] undefined undefined` (the session no longer pre-creates the truck or the family grant)

The spoofed `X-Forwarded-For` behavior is covered by Plan A's tests. Do not test it here, because every OTP request costs an SMS.

---

### Task 8: Stage 1, the full two-phone run, and the evidence file (human)

**Files:**
- Create: `docs/evidence/phone-run-2026-10-18.md`
- Create: `docs/evidence/phone-run-2026-10-18/*.png` (redacted only)
- Raw screenshots: `$RUN/evidence/private/phone-run-2026-10-18/` (gitignored by `evidence/private/`)

- [ ] **Step 1: Make the evidence branch and the template**

```bash
git -C "$MAIN" worktree add -b docs/phone-demo-evidence "$MAIN/.claude/worktrees/phone-demo-evidence" origin/main
EVID="$MAIN/.claude/worktrees/phone-demo-evidence"; mkdir -p "$EVID/docs/evidence/phone-run-2026-10-18" "$RUN/evidence/private/phone-run-2026-10-18"
```

Create `$EVID/docs/evidence/phone-run-2026-10-18.md` with exactly this content, then fill it in during the run:

```markdown
# Prueba en dos teléfonos reales · 2026-10-18

Corrida manual de la sección 8 de la [spec de la demo funcional](../superpowers/specs/2026-10-18-functional-phone-demo-design.md): completa sobre el túnel (etapa 1) y corta sobre AWS (etapa 2).

> **Alcance honesto.** Son una corrida completa y una corta, con dos teléfonos. **No completan la matriz del issue [#9](https://github.com/Bimbi-Dev/andes-hackathon/issues/9)** (estados del teléfono, sistemas, navegadores, redes, batería), y Android no es una plataforma soportada. Los tiempos de los checks son valores de demo (`SILENCE_MS=120000`, `ASK_GRACE_MS=60000`), no umbrales de seguridad ([#11](https://github.com/Bimbi-Dev/andes-hackathon/issues/11)). WhatsApp aparece como «No disponible»: la cuenta de Zavu no tiene WABA ni plantillas aprobadas.

Reglas: aquí no se anotan números de teléfono, códigos, tokens, el link del contacto ni coordenadas exactas. Las capturas de `phone-run-2026-10-18/` están recortadas; los originales quedan fuera de Git.

## Entorno

| Campo | Etapa 1 (túnel) | Etapa 2 (AWS) |
|---|---|---|
| Zona horaria de las horas anotadas | | |
| URL | `https://….trycloudflare.com` (efímera) | |
| Commit de `main` | | |
| Backend | laptop: API y 3 workers, Postgres 18 en Docker, SQS real | ECS Express: 1 tarea, RDS `db.t4g.micro`, SQS |
| `ZAVU_LIVE_SEND` | `true` | `true` |
| Canales calificados | PE · `es` y `pt-BR` · SMS (one-way). Llamada: «No disponible» | igual |
| Topes | tabla de SMS de la spec (DECISION PENDING). Recomendado: 8 códigos/día, 6 alertas/número/día | igual |
| Plan y saldo de Zavu antes / después (USD) | | |
| Verificación de URL de mapa (`POST /v1/urls`) | | — |

## Dispositivos

| Rol | Modelo | Sistema (Ajustes > General > Información) | Navegador y versión | Red (Wi-Fi o celular, operador, país) | Bloqueo automático | Bajo consumo |
|---|---|---|---|---|---|---|
| Conductor (A) | | | | | Nunca | No |
| Contacto (B) | | | | | Nunca | No |

Código de país del número del contacto (solo el prefijo, p. ej. `+51`): ____

## Etapa 1 · corrida completa (túnel)

| # | Paso | Esperado | Hora | Resultado | Notas | Captura |
|---|---|---|---|---|---|---|
| 1.1 | A: abre la URL, «Empezar», recorrido guiado | bienvenida; el recorrido nunca tapa el SOS | | | | s1-01-A.png |
| 1.2 | A: registra el camión | pasa a «Contacto» | | | | |
| 1.3 | A: agrega al contacto (número de B, «Mamá», familia) y comparte el link | «Esperando que tu contacto acepte…» | | | | s1-03-A.png |
| 1.4 | B: abre el link e ingresa su número | pide el código | | | hora del pedido | |
| 1.5 | B: llega el SMS «Demo de Tándem: tu código es …» | menos de 60 s | | | latencia (s): | s1-05-B.png (código tapado) |
| 1.6 | B: ingresa el código y acepta | A sale de «Esperando…» en 5 s o menos | | | | |
| 2.1 | A: crea el viaje (PE, es, llegada en 45 min o más) y confirma | viaje activo; fila del colega «no permitido» | | | | s1-07-A.png |
| 2.2 | B: ve el viaje | aparece en 5 s o menos | | | | |
| 3.1 | A: «Compartir ubicación» y permite | «compartiendo» en A y en B | | | | |
| 3.2 | B: hora de la última lectura durante 2 min | anotar los intervalos | | | intervalos (s): | |
| 4.1 | A: «Estoy bien» | confirmado | | | | |
| 4.2 | A: «Hacer una pausa» y luego «Continuar» | en pausa y de vuelta a activo | | | | |
| 5.1 | A: modo avión, con Wi-Fi y celular apagados | — | | | hora t_avión | |
| 5.2 | B: se abre el check | ≈ t_avión + 120–125 s | | | | s1-12-B.png |
| 5.3 | Escala a incidente de check | ≈ t_avión + 180–185 s | | | | |
| 5.4 | B: SMS de alerta de check | llega con el prefijo «Demo de Tándem» | | | latencia desde 5.3 (s): | s1-14-B.png |
| 5.5 | B: llamada de alerta | suena; se oye «Demo de Tándem» | | | duración (s): | |
| 5.6 | Canal WhatsApp | «No disponible» | | | | |
| 6.1 | A: quita el modo avión y espera la red | la página sigue abierta (no recargó) | | | | |
| 6.2 | A: SOS, un toque | — | | | hora t_SOS | |
| 6.3 | B: SMS con redacción de SOS («ALERTA: … pidió ayuda») | | | | t_SOS → SMS (s): | s1-18-B.png |
| 6.4 | B: llamada de SOS | suena | | | t_SOS → timbre (s): | |
| 6.5 | A: pantalla «Alertas» | SMS y llamada aceptados o entregados; WhatsApp «No disponible»; colega «no permitido» | | | | s1-20-A.png |
| 7.1 | A: «Ya estoy a salvo» | incidente resuelto en A y en B | | | | |
| 7.2 | A: «Llegué» | deja de compartir; resumen | | | | s1-22-A.png |
| 8.1 | A: viaje nuevo con el mismo contacto; comparte; bloquea la pantalla 60 s | anotar el estado en B («vieja» o «sin datos») | | | | |
| 8.2 | A: desbloquea | anotar si la página recargó (un mundo nuevo) | | | ¿recargó? | |
| 8.3 | A: «Llegué» | — | | | | |

### Registro del servidor (sin números ni coordenadas)

    (pegar aquí la salida de las consultas de la tarea 8, paso 5)

### Estados en Zavu

    (pegar aquí la salida del paso 6: id, canal, estado y código de error)

## Etapa 2 · corrida corta (AWS)

| # | Paso | Esperado | Hora | Resultado | Notas | Captura |
|---|---|---|---|---|---|---|
| 1 | A: «Empezar», camión, contacto con el número de B | «Esperando…» | | | | |
| 2 | B: código SMS y aceptación | código en menos de 60 s; A sale de «Esperando…» | | | latencia (s): | s2-02-B.png |
| 3 | A: viaje y «Compartir ubicación»; B lo ve | «compartiendo» | | | | |
| 4 | A: SOS | SMS y llamada de SOS en B | | | t_SOS → SMS / timbre (s): | s2-04-B.png |
| 5 | A: «Alertas» | SMS y llamada; WhatsApp «No disponible» | | | | s2-05-A.png |
| 6 | A: «Ya estoy a salvo» y «Llegué» | resuelto y terminado | | | | |

## Hallazgos

- 

## Qué no prueba esta corrida

- La matriz del #9: pantalla bloqueada por más tiempo, app en segundo plano, batería, mala cobertura y otros modelos.
- Android, WhatsApp, avisos a grupos, varios contactos y carga.
- La redacción de las alertas está solo en español, incluso con `pt-BR`.
```

- [ ] **Step 2: Prepare the phones** (checklist; tick each)
  - [ ] B's number has a country code in `DEMO_ALLOWED_COUNTRIES` and is not +1. Record only the prefix.
  - [ ] On both phones: Auto-Lock **Never** (Settings > Display & Brightness), Low Power Mode **off**, Focus and Do Not Disturb **off**, volume up.
  - [ ] On A: Location for Safari websites is set to *While Using* (Settings > Privacy & Security > Location Services). A knows how to toggle Airplane Mode **and** confirm in Control Center that Wi-Fi is off too, because iOS remembers Wi-Fi in Airplane Mode.
  - [ ] B's holder knows this is a test. The alerts say «Demo de Tándem». **They do not call 105.**
  - [ ] B's number has had fewer than 3 codes this hour (`DEMO_OTP_PER_NUMBER_HOURLY`).
  - [ ] Write down the Zavu balance before the run.
  - [ ] Pick one clock for all times (B's clock, network time) and write its time zone.

- [ ] **Step 3: Run the table in order** (about 25 minutes)

Notes for each step:
- Take each screenshot on the phone that sees the result. AirDrop it to `$RUN/evidence/private/phone-run-2026-10-18/`.
- If A's page reloads at any point before 7.1, its tokens are gone (they live only in memory, by design). Record it as a finding and restart from 1.1. Restarting costs one more code.
- Press «Continuar» after the pause. **No check opens while the trip is paused.**
- The lock test (8.x) runs on a second trip *after* the main run, so a reload cannot spoil the SOS steps.

- [ ] **Step 4: Watch the server while it runs** (optional; terminal 1)

```bash
docker compose exec -T db psql -U andes_admin -d andes -c "SELECT reason, status, created_at, ask_until, closed_at FROM security_checks ORDER BY created_at DESC LIMIT 3"
```

Expected during step 5.2: one row in `silence` · `asking`. After 5.3 the same row reads `escalated`.

- [ ] **Step 5: Server evidence after 8.3** (paste the output into the evidence file; it contains no numbers)

```bash
q() { docker compose exec -T db psql -U andes_admin -d andes -c "$1"; }
q "SELECT trigger, check_reason, status, created_at, resolved_at FROM incidents ORDER BY created_at DESC LIMIT 3"
q "SELECT coalesce(trigger,'') AS trigger, channel, status, coalesce(unavailable_reason,'') AS reason, count(*) FROM jobs GROUP BY 1,2,3,4 ORDER BY 1,2,3"
q "SELECT channel, state, coalesce(delivery_status,'') AS delivery, coalesce(rejection_code,'') AS rejection, count(*) FROM dispatch_attempts GROUP BY 1,2,3,4 ORDER BY 1,2"
q "SELECT type, status, disposition, count(*) FROM provider_events GROUP BY 1,2,3 ORDER BY 1,2"
```

Expected:
- One incident with `sos` · `silence` · `resolved`. The trigger is `sos` because the SOS upgraded the missed-check incident.
- Family jobs for `sms` with `trigger` `missed_check` and `sos`, each in `accepted` or `delivered`. `voice` stays `unavailable` until the appendix.
- `whatsapp` jobs in `unavailable` · `country_channel_locale_unqualified`.
- Colleague jobs refused, with the reason Plan A uses.
- `provider_events` rows mean signed callbacks arrived. If there are none, check the webhook URL, the secret, and whether Plan A maps `sms_oneway` callbacks.

- [ ] **Step 6: Delivery states in Zavu** (no destinations printed)

```bash
zavu GET "/messages?limit=15" | node -e 'for (const m of JSON.parse(require("fs").readFileSync(0,"utf8")).items) console.log(m.id, m.channel, m.status, m.errorCode ?? "")'
```

Expected:
- `delivered` or `sent` for the code SMS and the alert SMS. No calls until the appendix.
- `pending_url_verification` on an alert SMS confirms the Task 2 Step 4 risk. Record it.
- `RISK_*` codes mean Zavu's content review refused the message. Record it and tell Robert. Do not resend the same text.

- [ ] **Step 7: Redact and commit**

Copy the screenshots into `$EVID/docs/evidence/phone-run-2026-10-18/` and black out numbers, codes, the contact link, incident IDs and map coordinates. Use Preview > Markup > a filled rectangle; blur is not enough. Fill every cell of the table, the balance after the run and the findings.

```bash
cd "$EVID"
git add docs/evidence/phone-run-2026-10-18.md docs/evidence/phone-run-2026-10-18
git diff --cached --stat
git commit -m "docs(evidence): Record the two-phone run on the tunnel"
```

---

### Task 9: Stage 2, the AWS deploy (`$`)

**Files:** none committed (AWS state; `/tmp/andes-demo-service.json`)

Costs, as the script documents them:
- `database` ≈ 0.45 USD/day;
- `service` ≈ 1.5 USD/day;
- the six new secrets ≈ 0.40 USD/month each (≈ 0.08 USD/day);
- ECR storage: a few cents.

That comes to about 2 USD/day until `teardown`. Zavu sends are charged separately per message.

- [ ] **Step 1 (human, Robert): Go-ahead**

Robert says "go" in chat for `secrets`, `database` and `service`, and confirms the caps (`DEMO_SMS_DAILY_CAP`, `DEMO_ALERTS_PER_NUMBER_DAILY`). Record the time.

- [ ] **Step 2: Stop stage 1 and empty the queues** (free)

Ctrl-C `demo-local.sh` and `cloudflared`. Local workers must not consume the same queues as AWS.

```bash
cd "$RUN"; set -a; . "$MAIN/.env"; set +a
for q in emergency ordinary; do aws sqs purge-queue --queue-url "$(aws sqs get-queue-url --queue-name andes-demo-$q --query QueueUrl --output text)"; done; echo purged
```

Expected: `purged`. SQS may take up to 60 s to finish the purge.

- [ ] **Step 3: Load the deploy environment**

```bash
cd "$RUN" && git fetch origin && git checkout --detach origin/main && npm ci && npm --prefix web ci
set -a; . "$MAIN/.env"; set +a; export ZAVU_QUALIFICATION_JSON="$(cat "$MAIN/.env.qualification.json")"
ls db/migrations
```

Expected: the list includes Plan A's demo-phone migration. Every migration must be in this checkout **before** `bootstrap`, because after `lock` the laptop cannot reach RDS.

- [ ] **Step 4: `prepare`** (free; re-running adds `delivery-consume`)

```bash
infra/demo/deploy.sh prepare
aws iam get-role-policy --role-name andes-demo-task --policy-name delivery-consume --query 'PolicyDocument.Statement[0].Action' --output text
```

Expected: `prepared in <account>/us-east-1`, then `sqs:ReceiveMessage	sqs:DeleteMessage	sqs:ChangeMessageVisibility`.

- [ ] **Step 5: `secrets` (`$`)**

```bash
infra/demo/deploy.sh secrets
aws secretsmanager get-secret-value --secret-id andes-demo/zavu-project-id --query SecretString --output text | grep -qx "$ZAVU_PROJECT_ID" && echo "project id matches"
aws secretsmanager get-secret-value --secret-id andes-demo/zavu-qualification --query SecretString --output text | node -e 'const q=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(q.entries.length, "entries,", q.accountId === process.env.ZAVU_PROJECT_ID ? "this project" : "ANOTHER project")'
aws iam get-role-policy --role-name andes-demo-exec --policy-name demo-secrets --query 'length(PolicyDocument.Statement[0].Resource)'
```

Expected: `stored 6 secrets`, `project id matches`, `2 entries, this project`, `6`.

- [ ] **Step 6: `image`** (free, ECR cents; 5–15 min on Apple Silicon because it emulates amd64)

```bash
infra/demo/deploy.sh image
```

Expected: `sha256:…`. The image builds `web/dist` (Plan A's Dockerfile).

- [ ] **Step 7: `database` (`$`, about 10 min)**

```bash
infra/demo/deploy.sh database
```

Expected: an endpoint `andes-demo.….us-east-1.rds.amazonaws.com`.

- [ ] **Step 8: `bootstrap`, which applies the migrations**

```bash
infra/demo/deploy.sh bootstrap
```

Expected: `Database bootstrap and migrations applied` and `Seeded 40 synthetic reports`. If it fails, do **not** lock. Fix it and re-run, since it is idempotent.

- [ ] **Step 9: `lock`** (free; only after Step 8 succeeded at this commit)

```bash
infra/demo/deploy.sh lock
```

Expected: `locked`.

- [ ] **Step 10: `service` with live sends (`$`)**

```bash
ZAVU_LIVE_SEND=true infra/demo/deploy.sh service
```

Expected: `arn:aws:ecs:us-east-1:<account>:service/andes-demo/andes-demo` or similar. Pass `DEMO_SMS_DAILY_CAP` and `DEMO_ALERTS_PER_NUMBER_DAILY` on the same line only if Robert changed the spec SMS caps table.

- [ ] **Step 11: Get the URL and wait for health**

```bash
DEMO_URL=$(infra/demo/deploy.sh url); case $DEMO_URL in https://*) ;; *) DEMO_URL="https://$DEMO_URL" ;; esac; DEMO_URL=${DEMO_URL%/}; echo "$DEMO_URL"
until curl -fsS "$DEMO_URL/health"; do sleep 20; done; echo
```

Expected: an `https://…` origin, then `{"status":"ok"}` after a few minutes. If `url` prints a status object instead of an endpoint, the service is still provisioning, so run it again in a minute. Record `DEMO_URL` in the evidence file.

- [ ] **Step 12: Check that the task is not crash-looping**

```bash
arn=$(aws ecs list-services --cluster andes-demo --query 'serviceArns[0]' --output text)
t1=$(aws ecs list-tasks --cluster andes-demo --query 'taskArns' --output text); sleep 180
t2=$(aws ecs list-tasks --cluster andes-demo --query 'taskArns' --output text); [ "$t1" = "$t2" ] && echo "same task for 3 min"
aws logs tail /ecs/andes-demo --since 15m | grep -E 'stopped with error|startup failed' || echo "no worker/API failures"
```

Expected: `same task for 3 min` and `no worker/API failures`. A changing task ARN means `wait -n; exit 1` fired. Read the log lines right before it.

- [ ] **Step 13: Point the Zavu webhook at AWS**

```bash
zavu PATCH "/senders/$ZAVU_SENDER_ID" "{\"webhookUrl\":\"$DEMO_URL/v1/callbacks/zavu\"}" | pick webhook.url webhook.active
```

Expected: `https://…/v1/callbacks/zavu true`.

- [ ] **Step 14: Smoke test on AWS**

Repeat Task 7 Step 10 with `PUBLIC="$DEMO_URL"`. The expected output is the same seven results.

- [ ] **Step 15: Kill-switch drill** (recommended, free, about 15 min; proves "sin caída")

```bash
ZAVU_LIVE_SEND=false infra/demo/deploy.sh service
aws ecs wait services-stable --cluster andes-demo --services "$arn"; curl -fsS "$DEMO_URL/health"; echo
TOKEN=$(curl -sS -X POST "$DEMO_URL/v1/demo/session" -H 'content-type: application/json' -d '{}' | pick family.token)
read -r -s -p "B's phone in E.164 (not echoed): " PHONE; echo
curl -sS -w ' %{http_code}\n' -X POST "$DEMO_URL/v1/demo/phone/start" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}"
unset PHONE TOKEN
```

Expected: `updated arn:…`, `{"status":"ok"}`, then `{"code":"demo_sms_disabled"} 503`, and no SMS reaches B. Use B's own number, so a mistake costs one code to a consenting person. Then repeat Step 12 (`same task for 3 min`) and switch sends back on:

```bash
ZAVU_LIVE_SEND=true infra/demo/deploy.sh service && aws ecs wait services-stable --cluster andes-demo --services "$arn" && curl -fsS "$DEMO_URL/health"; echo
```

If a later `image` push does not show up, the unchanged container definition did not trigger a rollout. Force one with `aws ecs update-service --cluster andes-demo --service "$arn" --force-new-deployment`.

---

### Task 10: Stage 2, the short phone run on AWS (human)

**Files:** Modify `docs/evidence/phone-run-2026-10-18.md`; add `docs/evidence/phone-run-2026-10-18/s2-*.png`

- [ ] **Step 1: Repeat the phone checklist** from Task 8 Step 2. B's code count for the hour still applies.
- [ ] **Step 2: Run the stage 2 table** at `$DEMO_URL`: start, truck, contact, code, accept, trip, location, SOS, alerts, «Ya estoy a salvo» and «Llegué». It takes about 10 minutes.

There is no silence step here: it saves 4 minutes and two alerts. The RDS database is locked, so the evidence comes from the app's «Alertas» screen and from Task 8 Step 6's Zavu listing.

- [ ] **Step 3: Logs check after the run**

```bash
aws logs tail /ecs/andes-demo --since 30m | grep -E 'stopped with error|startup failed|Worker operation failed' || echo "no failures logged"
```

Expected: `no failures logged`. One `Worker operation failed` line is a transient loop error. Record it.

- [ ] **Step 4: Redact, fill in and commit**

```bash
cd "$EVID"
git add docs/evidence/phone-run-2026-10-18.md docs/evidence/phone-run-2026-10-18
git commit -m "docs(evidence): Add the short AWS phone run"
```

---

### Task 11: `DEMO_URL` in the deck, README and descripción (PR 2)

**Files:**
- Modify: `docs/submission/deck/index.html` (the `const DEMO_URL = '';` line)
- Modify: `README.md`, `docs/submission/descripcion.md` (demo and deploy status lines)

**Honesty gate:** the new lines say SMS and calls work. Run this task only if both stage 2 rows 4 and 5 passed. Otherwise, edit the wording in the script to state what actually happened.

- [ ] **Step 1: Rebase the evidence branch on the latest `main`**

```bash
cd "$EVID" && git fetch origin && git rebase origin/main
grep -n "const DEMO_URL = \|PENDIENTE: URL de\|EN CONSTRUCCIÓN\|Nada está desplegado\|No se ha ejecutado\|En \`23e9f33\`" README.md docs/submission/descripcion.md docs/submission/deck/index.html
```

Expected: the lines the script edits. Line numbers may have moved, so the script matches each line by its prefix.

- [ ] **Step 2: Write the one-off edit script** (outside the repo; not committed)

```bash
cat > /tmp/fill-demo-url.mjs <<'JS'
// One-off (not committed): put the AWS demo URL in the deck and update the README/descripción lines it makes false.
// Each edit replaces the one line that starts with the given prefix (null deletes it); a missing prefix means it already changed.
import { readFileSync, writeFileSync } from 'node:fs';
const url = process.env.DEMO_URL ?? '';
if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) throw new Error('Set DEMO_URL to the https:// origin from deploy.sh url, no trailing slash');
const evidence = 'docs/evidence/phone-run-2026-10-18.md';
const edits = {
  'docs/submission/deck/index.html': [
    ["const DEMO_URL = '", `const DEMO_URL = '${url}';  // ECS Express demo from infra/demo/deploy.sh, 2026-10-18`],
  ],
  'README.md': [
    ['  <a href="#para-el-jurado-cómo-entrar"><code>Demo · en construcción</code></a>', `  <a href="${url}"><code>Demo · en vivo</code></a>`],
    ['> **La demo guiada está EN CONSTRUCCIÓN', `> **La demo está en línea.** Ábrela en un teléfono. Los envíos reales (SMS y llamada, para viajes en Perú) están activados con tope; WhatsApp aparece como «No disponible». Así se probó: [corrida en dos teléfonos](${evidence}).`],
    ['**Demo:** [[PENDIENTE: URL de la demo]]', `**Demo:** ${url}`],
    ['Se abrirá en una ventana privada', 'Ábrela en una ventana privada, sin cuenta, sin pedir acceso y sin archivos locales. El botón **Empezar** crea una sesión de demostración aislada ([`POST /v1/demo/session`](docs/contracts/runtime.md#demo-mode)). El único permiso que pide el navegador es la ubicación, y solo al tocar «Compartir ubicación».'],
    ['Recorrido previsto:', 'Recorrido:'],
    ['Tocar SOS varias veces no duplica avisos', 'Tocar SOS varias veces no duplica avisos: todos los toques se unen al mismo episodio. «Llegué» no cierra un SOS abierto. En la demo, la entrega real por Zavu está activada con tope para SMS y llamada; WhatsApp aparece como «No disponible» porque no hay plantillas aprobadas.'],
    ['- **La app web de producción es un cascarón.**', null],
    ['- **Las pantallas del conductor y el recorrido guiado**', null],
    ['- **Nada está desplegado.**', `- **Alta disponibilidad.** La demo corre en una sola tarea y una sola zona de AWS. La [prueba en dos teléfonos](${evidence}) es una corrida: no completa la matriz de [#9](https://github.com/Bimbi-Dev/andes-hackathon/issues/9).`],
    ['- **La entrega real por Zavu no está confirmada.**', '- **WhatsApp** no está habilitado en Zavu (sin plantillas aprobadas): en la demo aparece como «No disponible». SMS y llamada sí, con tope.'],
    ['- **Demo reducida:** [`infra/demo/deploy.sh`]', '- **Demo reducida:** [`infra/demo/deploy.sh`](infra/demo/deploy.sh) usa ECS Express Mode con una sola tarea Fargate (API, worker de control y, con `ZAVU_LIVE_SEND=true`, los dos consumidores de entrega), RDS PostgreSQL 18.3 `db.t4g.micro` en una sola zona y las dos colas SQS. Va paso a paso (`prepare`, `secrets`, `image`, `database`, `bootstrap`, `lock`, `service`, `url`, `teardown`) y se niega a correr si la cuenta del perfil no es la indicada en `ANDES_AWS_ACCOUNT`. Los comentarios del script estiman unos 2 USD al día. No demuestra alta disponibilidad. Se ejecutó el 2026-10-18.'],
    ['- En `23e9f33`, [`deploy.sh`]', '- [`deploy.sh`](infra/demo/deploy.sh) arranca los consumidores de entrega solo con `ZAVU_LIVE_SEND=true`; con `false` la API sigue arriba y los envíos quedan como no disponibles. La imagen Docker sirve la API, `/mapa` y la app web.'],
  ],
  'docs/submission/descripcion.md': [
    ['- Demo: [[PENDIENTE: URL de despliegue]]', `- Demo: ${url}`],
    ['- **En construcción:**', null],
    ['- **No desplegado:**', '- **Desplegado:** demo reducida en AWS (una tarea, una zona) desde el 2026-10-18.'],
    ['- **Entrega real por Zavu (SMS, WhatsApp, llamada):**', '- **Entrega real por Zavu:** SMS y llamada, activados con tope en la demo para viajes en Perú y probados en dos teléfonos el 2026-10-18 ([evidencia](../evidence/phone-run-2026-10-18.md)). WhatsApp aparece como «No disponible»: no hay plantillas aprobadas.'],
  ],
};
for (const [file, pairs] of Object.entries(edits)) {
  let rows = readFileSync(file, 'utf8').split('\n');
  for (const [prefix, next] of pairs) {
    const hits = rows.filter(row => row.startsWith(prefix)).length;
    if (hits > 1) throw new Error(`${file}: ${hits} lines start with ${prefix}`);
    if (!hits) { console.log(`skip (already changed) ${file}: ${prefix}`); continue; }
    rows = next === null ? rows.filter(row => !row.startsWith(prefix)) : rows.map(row => row.startsWith(prefix) ? next : row);
  }
  writeFileSync(file, rows.join('\n'));
  console.log(`edited ${file}`);
}
JS
```

- [ ] **Step 3: Run it with the recorded URL**

```bash
DEMO_URL="$DEMO_URL" node /tmp/fill-demo-url.mjs
git diff --stat
grep -c "PENDIENTE: URL de la demo\|PENDIENTE: URL de despliegue\|en construcción" README.md docs/submission/descripcion.md
grep -n "^const DEMO_URL" docs/submission/deck/index.html
```

Expected:
- `edited` for all three files, plus any `skip` lines for edits Plan B already made;
- the diff stat lists only those three files;
- the counts are `README.md:0` and `docs/submission/descripcion.md:0`;
- the deck line shows the AWS URL.

The script was dry-run against `origin/main` at b297cb8 with a sample URL, and every prefix matched exactly once.

- [ ] **Step 4: Look at the deck**

```bash
open docs/submission/deck/index.html
```

Expected: on both slides that show «Demo en vivo», the grey «URL pendiente» is replaced by a link to the AWS host (`[data-demo]`, `index.html:356`). Click it on a phone and the driver app opens.

- [ ] **Step 5: Commit and open PR 2**

```bash
git add docs/submission/deck/index.html README.md docs/submission/descripcion.md
git commit -m "docs(submission): Fill DEMO_URL and update the demo and deploy status"
git push -u origin docs/phone-demo-evidence
gh pr create --base main --title "docs: phone-run evidence and DEMO_URL" --body "Evidence of the two-phone run (tunnel, full; AWS, short) and the AWS demo URL in the deck, README and descripción. One run does not complete the #9 matrix; WhatsApp stays «No disponible». Plan: docs/superpowers/plans/2026-10-18-phone-demo-plan-c-ops.md tasks 8, 10, 11."
```

Robert merges.

---

### Task 12: After the event (Robert decides when)

**Files:** none

- [ ] **Step 1: Keep the URL up through judging.** If spend must stop but the page must stay up, run `ZAVU_LIVE_SEND=false infra/demo/deploy.sh service`. The app stays up, but no codes are sent, so contacts cannot verify.

- [ ] **Step 2: Teardown** (stops all AWS charges)

```bash
cd "$RUN"; set -a; . "$MAIN/.env"; set +a
infra/demo/deploy.sh teardown
aws secretsmanager list-secrets --filters Key=name,Values=andes-demo/ --query 'SecretList[].Name' --output text
```

Expected: the `Deleting; …` line, then empty output once deletion finishes. RDS deletion takes several minutes.

- [ ] **Step 3: Turn off the webhook**

```bash
zavu PATCH "/senders/$ZAVU_SENDER_ID" '{"webhookUrl":null}' | pick id
```

- [ ] **Step 4 (human, Robert): Rotate the Zavu API key.** It was pasted into a chat.
  1. In the dashboard, create a new live key.
  2. Replace `ZAVU_API_KEY` in `$MAIN/.env`.
  3. Revoke the old key.

  If AWS is still up, also run `infra/demo/deploy.sh secrets` and then `aws ecs update-service --cluster andes-demo --service "$arn" --force-new-deployment`.

- [ ] **Step 5: Voice number.** Only if the appendix bought one. A paid number is released there before teardown.

- [ ] **Step 6: Delete the local demo data.** It holds verified contact numbers, and the 24 h purge runs only while `worker control` runs.

```bash
cd "$RUN" && docker compose down -v
git -C "$MAIN" worktree remove "$RUN"
```

---

## Risks and open items

| Risk | Effect | Mitigation in this plan |
|---|---|---|
| Zavu verifies URLs **one exact URL at a time**, and each alert SMS has a unique `maps.google.com/?q=` link (`wording.ts:26`) | Alert SMS may wait in `pending_url_verification` until manual approval | Task 2 Step 4 checks auto-approval up front. If it is not automatic, Plan A decides whether to drop the link from demo SMS. Calls are unaffected |
| Zavu content review reads every SMS and call ("posible robo", "pidió ayuda") | Messages held (`queued` for up to a couple of hours) or refused (`RISK_*`). Repeated refusals suspend sending | Every text starts «Demo de Tándem». Task 8 Step 6 records the states. Never resend refused text |
| +1 destinations need 10DLC for SMS | A US or Canadian contact cannot get the code | The contact phone must have a non-+1 number in `DEMO_ALLOWED_COUNTRIES` (Robert item 6) |
| Zavu daily ceilings (unverified floor: 25 SMS a day) | Judges run out of codes | Task 2 Step 1 reads the ceilings. Qualification limits copy the SMS caps table and stay under 25 |
| Plan A's `smsMode: 'oneway'` must also handle `sms_oneway` in the send reply (`zavu.ts:56`), in reads, and in callbacks (`zavu.ts:123` accepts only `sms`, `whatsapp` and `voice`) | Otherwise SMS attempts end `unknown` and callbacks get 401 | Task 7 Step 7 and the `provider_events` query in Task 8 Step 5 expose it. Fix it in Plan A |
| Voice purchase is the appendix | Calls stay «No disponible» | Do not add voice qualification entries in Tasks 1–12 |
| Alert bodies are Spanish only (`wording.ts:15`) | `pt-BR` users get Spanish | The pt-BR SMS prefix says «mensagem em espanhol» |
| Recording a page reload creates a new world (#81) | A reload in the middle of a run blocks the SOS steps | Airplane mode replaces screen lock for the silence step. The lock test runs on a second trip after the main run |
| iOS stops location with the screen locked | The contact sees «sin datos» | The run records it honestly (row 8.x). The server check covers the gap only while B's screen stays open |
| The quick tunnel URL changes on every restart, and it has no uptime guarantee | The webhook goes stale | After any restart, run the Task 7 Step 6 PATCH again. Stage 1 is for rehearsal; judges get the AWS URL |
| Local workers use Robert's personal AWS profile for SQS | Broader credentials than the task role | Accepted for stage 1 on his own laptop. In AWS, the task role holds only the four SQS actions |
| `service` updates leave an unchanged container definition untouched | A new `:latest` image is not rolled out | The force-new-deployment command noted in Task 9 Step 15 |
| Cost | AWS ≈ 2 USD/day plus Zavu per message | `$` gates; `demoLimits`, `DEMO_ALERTS_PER_NUMBER_DAILY`, `DEMO_SMS_DAILY_CAP`, `dailyLimit`; Task 12 teardown |
| The API key was pasted into a chat | The key may have leaked | Task 12 Step 4 rotates it |

## Spec items this plan changes or cannot meet

1. **Success criterion 6** ("SMS, WhatsApp y llamada reales") **cannot be met for WhatsApp or calls**: there is no WABA, and voice is the appendix. Both show «No disponible». SMS is real.
2. **§1 assumed `create-express-gateway-service` only.** Flipping `ZAVU_LIVE_SEND` and rolling out changes needs `update-express-gateway-service`, so `service` now updates in place.
3. **§1 says `deploy.sh prepare` is free; the new secrets are not** (≈ 0.40 USD/month each). They live in a separate `$` step, `secrets`, so stage 1 can run `prepare` before Zavu is fully set up.
4. **§8 step 3 (behavior with the screen locked)** conflicts with "a reload ruins the run". It moves to a second trip after the main run (rows 8.x).
5. **`CONTACT_APP_URL` stays unset.** Its `/incidents/<id>` link is not a route in the spec's web app, and Zavu would have to verify one more URL.

## Appendix: deferred Zavu voice purchase

Not on the critical path. Both stages stay SMS-only and show calls as «No disponible». Buying one voice number needs Robert's go and a redeemed coupon. Until that number is live, do not add voice qualification entries and do not treat calls as part of the run. After it is live, add the voice entries and switch the stack; that work is outside Tasks 1–12. Release a paid number before teardown.
