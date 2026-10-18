-- Demo personas are free to mint, so what they create stays demo data whatever mode the server later runs in.
ALTER TABLE identities ADD COLUMN synthetic boolean NOT NULL DEFAULT false;
UPDATE identities SET synthetic = true WHERE issuer = 'https://demo.andes.invalid'; -- personas minted before this column
CREATE OR REPLACE VIEW security_events AS
  SELECT n.label AS kind, n.latitude, n.longitude, n.created_at AS occurred_at, i.synthetic, n.driver_id AS contributor
    FROM incidents n JOIN identities i ON i.id = n.driver_id
    WHERE n.label IN ('robo','intento_robo') AND n.latitude IS NOT NULL AND n.accuracy <= 1000 AND n.located_at >= n.created_at - interval '1 hour'
  UNION ALL SELECT kind, latitude, longitude, occurred_at, synthetic, reporter_id FROM reports;
