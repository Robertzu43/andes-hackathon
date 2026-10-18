CREATE TABLE identities (
  id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  phone text, phone_verified boolean NOT NULL DEFAULT false,
  UNIQUE (issuer, subject)
);
CREATE TABLE trucks (
  id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES identities, label text NOT NULL,
  UNIQUE(id, driver_id)
);
CREATE TABLE contact_grants (
  id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES identities,
  contact_id uuid NOT NULL REFERENCES identities, phone text NOT NULL,
  map_requested boolean NOT NULL, incident_requested boolean NOT NULL,
  map_accepted boolean NOT NULL DEFAULT false, incident_accepted boolean NOT NULL DEFAULT false,
  accepted_at timestamptz, revoked_at timestamptz, revoked_by uuid REFERENCES identities,
  CHECK(driver_id <> contact_id), UNIQUE(driver_id, contact_id),
  CHECK(NOT map_accepted OR map_requested), CHECK(NOT incident_accepted OR incident_requested)
);
CREATE TABLE trip_drafts (
  id uuid PRIMARY KEY, driver_id uuid NOT NULL REFERENCES identities,
  raw_text text NOT NULL, fields jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE trips (
  id uuid PRIMARY KEY REFERENCES trip_drafts, driver_id uuid NOT NULL REFERENCES identities,
  truck_id uuid NOT NULL, origin text NOT NULL, destination text NOT NULL,
  country text NOT NULL, locale text NOT NULL, time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','arrived','cancelled')),
  map_active boolean NOT NULL DEFAULT true, checkins_active boolean NOT NULL DEFAULT true,
  paused boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL, closed_at timestamptz,
  FOREIGN KEY(truck_id, driver_id) REFERENCES trucks(id, driver_id)
);
CREATE TABLE trip_grants (
  trip_id uuid NOT NULL REFERENCES trips, grant_id uuid NOT NULL REFERENCES contact_grants,
  revoked_at timestamptz, revoked_by uuid REFERENCES identities, PRIMARY KEY(trip_id, grant_id)
);
CREATE TABLE locations (
  trip_id uuid NOT NULL REFERENCES trips, captured_at timestamptz NOT NULL, received_at timestamptz NOT NULL,
  latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  accuracy double precision NOT NULL CHECK(accuracy >= 0),
  PRIMARY KEY(trip_id, captured_at)
);
CREATE TABLE latest_locations (LIKE locations INCLUDING ALL);
ALTER TABLE latest_locations DROP CONSTRAINT latest_locations_pkey;
ALTER TABLE latest_locations ADD PRIMARY KEY(trip_id);
ALTER TABLE latest_locations ADD FOREIGN KEY(trip_id) REFERENCES trips;
CREATE TABLE incidents (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips, driver_id uuid NOT NULL REFERENCES identities,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved')),
  created_at timestamptz NOT NULL, resolved_at timestamptz, resolved_by uuid REFERENCES identities
);
CREATE UNIQUE INDEX one_active_incident ON incidents(trip_id) WHERE status = 'active';
CREATE TABLE jobs (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips, incident_id uuid REFERENCES incidents,
  grant_id uuid REFERENCES contact_grants, recipient_id uuid REFERENCES identities,
  channel text NOT NULL CHECK(channel IN ('sms','whatsapp','voice','group')),
  class text NOT NULL CHECK(class IN ('emergency','ordinary')),
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL CHECK(status IN ('pending','claimed','authorized','accepted','rejected','unknown','delivered','cancelled','unavailable')),
  unavailable_reason text, created_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
  expires_at timestamptz, cancelled_at timestamptz,
  CHECK(channel = 'group' OR (grant_id IS NOT NULL AND recipient_id IS NOT NULL))
);
CREATE UNIQUE INDEX jobs_incident_recipient_channel ON jobs(incident_id,recipient_id,channel) NULLS NOT DISTINCT WHERE incident_id IS NOT NULL;
CREATE INDEX jobs_pending ON jobs(class, due_at) WHERE status = 'pending';
CREATE INDEX jobs_trip ON jobs(trip_id);
CREATE TABLE outbox (
  id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs, job_version integer NOT NULL,
  class text NOT NULL CHECK(class IN ('emergency','ordinary')),
  created_at timestamptz NOT NULL, published_at timestamptz,
  lease_owner text, lease_until timestamptz, next_publish_at timestamptz NOT NULL,
  UNIQUE(job_id, job_version)
);
CREATE INDEX outbox_due ON outbox(next_publish_at) WHERE published_at IS NULL;
CREATE TABLE trip_events (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips, actor_id uuid NOT NULL REFERENCES identities,
  kind text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE incident_events (
  id uuid PRIMARY KEY, incident_id uuid NOT NULL REFERENCES incidents, actor_id uuid NOT NULL REFERENCES identities,
  kind text NOT NULL CHECK(kind IN ('acknowledged','action','resolved','sos_report')),
  detail text, created_at timestamptz NOT NULL
);
CREATE TABLE idempotency (
  actor_id uuid NOT NULL REFERENCES identities, scope text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(actor_id, scope, key)
);
