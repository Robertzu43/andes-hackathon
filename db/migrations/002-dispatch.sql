ALTER TABLE jobs ADD COLUMN claim_token uuid, ADD COLUMN claim_owner text, ADD COLUMN claim_until timestamptz;
ALTER TABLE outbox ADD COLUMN publish_attempts integer NOT NULL DEFAULT 0;
CREATE TABLE dispatch_attempts (
  id uuid PRIMARY KEY, job_id uuid NOT NULL UNIQUE REFERENCES jobs, job_version integer NOT NULL,
  owner text NOT NULL, claim_token uuid NOT NULL, project_id text NOT NULL, sender_id text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('sms','whatsapp','voice')),
  state text NOT NULL CHECK(state IN ('authorized','accepted','rejected','unknown')),
  payload jsonb, payload_hash text NOT NULL, destination_hash text NOT NULL,
  authorized_at timestamptz NOT NULL, finished_at timestamptz,
  provider_message_id text, downstream_message_id text, rejection_code text,
  delivery_status text, next_reconcile_at timestamptz, reconcile_count integer NOT NULL DEFAULT 0,
  reconcile_token uuid, reconcile_until timestamptz, evidence_expires_at timestamptz NOT NULL,
  UNIQUE(project_id,provider_message_id)
);
CREATE INDEX attempts_reconcile ON dispatch_attempts(next_reconcile_at) WHERE next_reconcile_at IS NOT NULL;
CREATE TABLE quota_accounts (project_id text PRIMARY KEY);
CREATE TABLE quota_reservations (
  attempt_id uuid PRIMARY KEY REFERENCES dispatch_attempts, project_id text NOT NULL REFERENCES quota_accounts,
  channel text NOT NULL, class text NOT NULL, reserved_at timestamptz NOT NULL
);
CREATE INDEX quota_window ON quota_reservations(project_id,reserved_at);
CREATE TABLE provider_events (
  project_id text NOT NULL, event_id text NOT NULL, sender_id text NOT NULL,
  message_id text NOT NULL, channel text NOT NULL, destination_hash text NOT NULL,
  type text NOT NULL, status text NOT NULL, error_code text, dispatched_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL, raw_hash text NOT NULL, disposition text NOT NULL DEFAULT 'unmatched',
  attempt_id uuid REFERENCES dispatch_attempts, evidence_expires_at timestamptz NOT NULL,
  PRIMARY KEY(project_id,event_id)
);
CREATE INDEX events_unmatched ON provider_events(project_id,message_id) WHERE disposition='unmatched';
CREATE TABLE provider_requests (
  id uuid PRIMARY KEY, project_id text NOT NULL REFERENCES quota_accounts,
  kind text NOT NULL CHECK(kind IN ('send','read')), reserved_at timestamptz NOT NULL
);
CREATE INDEX requests_window ON provider_requests(project_id,reserved_at);
