ALTER TABLE incidents ADD COLUMN latitude double precision, ADD COLUMN longitude double precision,
  ADD COLUMN accuracy double precision, ADD COLUMN located_at timestamptz,
  ADD COLUMN label text CHECK (label IN ('robo','intento_robo','falsa_alarma','sin_senal','otro')),
  ADD COLUMN labeled_at timestamptz, ADD COLUMN labeled_by uuid REFERENCES identities;
CREATE FUNCTION incident_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT latitude, longitude, accuracy, captured_at INTO NEW.latitude, NEW.longitude, NEW.accuracy, NEW.located_at
    FROM latest_locations WHERE trip_id = NEW.trip_id;
  RETURN NEW;
END $$;
CREATE TRIGGER incident_location BEFORE INSERT ON incidents FOR EACH ROW EXECUTE FUNCTION incident_location();
CREATE TABLE reports (
  id uuid PRIMARY KEY, reporter_id uuid NOT NULL REFERENCES identities,
  kind text NOT NULL CHECK (kind IN ('robo','intento_robo')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL,
  synthetic boolean NOT NULL DEFAULT false
);
CREATE INDEX reports_time ON reports(occurred_at);
CREATE VIEW security_events AS
  SELECT label AS kind, latitude, longitude, created_at AS occurred_at, false AS synthetic FROM incidents
    WHERE label IN ('robo','intento_robo') AND latitude IS NOT NULL
  UNION ALL SELECT kind, latitude, longitude, occurred_at, synthetic FROM reports;
CREATE FUNCTION time_band(t timestamptz, tz text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN extract(hour FROM t AT TIME ZONE tz) >= 22 OR extract(hour FROM t AT TIME ZONE tz) < 6 THEN 'noche' ELSE 'dia' END
$$;
