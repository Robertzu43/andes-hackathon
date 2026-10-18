-- Bounded owner catalogs (GET /v1/trucks, /v1/contacts, /v1/trips, /v1/bootstrap): owner equality, then the exact list order.
CREATE INDEX trucks_driver_catalog ON trucks(driver_id, label, id);
CREATE INDEX contacts_driver_catalog ON contact_grants(driver_id, id);
CREATE INDEX trips_driver_active_catalog ON trips(driver_id, created_at DESC, id DESC)
  WHERE status = 'active';
CREATE INDEX trips_driver_recent_catalog ON trips(driver_id, (COALESCE(closed_at, created_at)) DESC, id DESC)
  WHERE status <> 'active';
