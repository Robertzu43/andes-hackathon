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
# Optional <Secrets Manager name under $N/>:<variable the task receives>. Each is stored and injected only when that variable is set.
# Live Zavu is off unless ZAVU_LIVE_SEND=true, and these six stay unset for the web/dist + POST /v1/demo/session deploy. The app DB password stays required.
SECRETS="zavu-api-key:ZAVU_API_KEY zavu-callback-secret:ZAVU_CALLBACK_SECRET zavu-qualification:ZAVU_QUALIFICATION_JSON demo-phone-pepper:DEMO_PHONE_PEPPER zavu-project-id:ZAVU_PROJECT_ID zavu-sender-id:ZAVU_SENDER_ID"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
# Explicit opt-in per account: a wrong or default profile cannot deploy (or tear down) anything.
[ "$ACCOUNT" = "$ANDES_AWS_ACCOUNT" ] || { echo "Refusing: profile account $ACCOUNT is not ANDES_AWS_ACCOUNT" >&2; exit 1; }
REPO="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/$N"
queue_url() { aws sqs get-queue-url --queue-name "$N-$1" --query QueueUrl --output text; }
queue_arn() { aws sqs get-queue-attributes --queue-url "$(queue_url "$1")" --attribute-names QueueArn --query Attributes.QueueArn --output text; }
secret_arn() { aws secretsmanager describe-secret --secret-id "$1" --query ARN --output text; }
secret_arns() { for pair in $SECRETS; do var="${pair#*:}"; [ -n "${!var:-}" ] || continue; printf '"%s",' "$(secret_arn "$N/${pair%%:*}")"; done | sed 's/,$//'; }
service_secrets() { { printf '{"name":"PGPASSWORD","valueFrom":"%s"},' "$(secret_arn "$N/app-db")"; for pair in $SECRETS; do var="${pair#*:}"; [ -n "${!var:-}" ] || continue; printf '{"name":"%s","valueFrom":"%s"},' "$var" "$(secret_arn "$N/${pair%%:*}")"; done; } | sed 's/,$//'; }
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
secrets) # $ ~0.40/month for each secret that is set. Unset Zavu and pepper values are skipped; none of them are required.
  n=0
  for pair in $SECRETS; do
    var="${pair#*:}"; [ -n "${!var:-}" ] || continue
    id="$N/${pair%%:*}"
    # Values go through stdin, never the command line, so they never show in the process list.
    if aws secretsmanager describe-secret --secret-id "$id" >/dev/null 2>&1; then printf %s "${!var}" | aws secretsmanager put-secret-value --secret-id "$id" --secret-string file:///dev/stdin >/dev/null
    else printf %s "${!var}" | aws secretsmanager create-secret --name "$id" --tags "$TAGS" --secret-string file:///dev/stdin >/dev/null; fi
    n=$((n+1))
  done
  if [ "$n" -gt 0 ]; then
    aws iam put-role-policy --role-name "$N-exec" --policy-name demo-secrets --policy-document \
      "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":[$(secret_arns)]}]}"
  fi
  echo "stored $n secrets" ;;
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
   {"name":"DEMO_OTP_PER_IP_HOURLY","value":"${DEMO_OTP_PER_IP_HOURLY:-5}"},{"name":"DEMO_SMS_DAILY_CAP","value":"${DEMO_SMS_DAILY_CAP:-40}"},
   {"name":"DEMO_ALERTS_PER_NUMBER_DAILY","value":"${DEMO_ALERTS_PER_NUMBER_DAILY:-12}"},
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
