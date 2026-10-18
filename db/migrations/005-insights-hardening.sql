CREATE INDEX reports_reporter_time ON reports(reporter_id, created_at);
-- An incident counts only where the driver actually was: its copied location must be at most an hour older than the alert.
CREATE OR REPLACE VIEW security_events AS
  SELECT label AS kind, latitude, longitude, created_at AS occurred_at, false AS synthetic, driver_id AS contributor FROM incidents
    WHERE label IN ('robo','intento_robo') AND latitude IS NOT NULL AND accuracy <= 1000 AND located_at >= created_at - interval '1 hour'
  UNION ALL SELECT kind, latitude, longitude, occurred_at, synthetic, reporter_id FROM reports;
