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
# Same demo values as infra/demo/deploy.sh `service` (spec §5). Caps default to 8 codes and 6 alerts so a local run stays inside Zavu's 25 SMS/day ceiling.
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
