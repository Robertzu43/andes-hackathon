-- Bounded owner catalogs: equality on owner followed by the exact list order.
-- 003 is reserved for the independently reviewed security-check runtime migration.
CREATE INDEX trucks_driver_catalog ON trucks(driver_id, label, id);
CREATE INDEX contacts_driver_catalog ON contact_grants(driver_id, id);
CREATE INDEX trips_driver_active_catalog ON trips(driver_id, created_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX trips_driver_recent_catalog ON trips(driver_id, (COALESCE(closed_at, created_at)) DESC, id DESC)
  WHERE status <> 'active';
