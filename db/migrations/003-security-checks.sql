ALTER TABLE trips ADD COLUMN expected_arrival_at timestamptz, ADD COLUMN sharing_stopped_at timestamptz;
ALTER TABLE contact_grants ADD COLUMN role text NOT NULL DEFAULT 'family' CHECK (role IN ('family','colleague'));
ALTER TABLE incidents
  ADD COLUMN trigger text NOT NULL DEFAULT 'sos' CHECK (trigger IN ('sos','missed_check')),
  ADD COLUMN check_reason text CHECK (check_reason IN ('arrival_overdue','silence','sharing_stopped'));
CREATE TABLE security_checks (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips,
  reason text NOT NULL CHECK (reason IN ('arrival_overdue','silence','sharing_stopped')),
  status text NOT NULL CHECK (status IN ('asking','ok','escalated','cancelled')),
  signal_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL, ask_until timestamptz NOT NULL,
  closed_at timestamptz, incident_id uuid REFERENCES incidents
);
CREATE UNIQUE INDEX one_open_check ON security_checks(trip_id) WHERE status = 'asking';
