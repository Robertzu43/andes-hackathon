-- An explicit SOS on a missed-check incident sends its own SOS-worded alerts: one job per incident, recipient, channel and trigger.
ALTER TABLE jobs ADD COLUMN trigger text CHECK (trigger IN ('sos','missed_check'));
DROP INDEX jobs_incident_recipient_channel;
CREATE UNIQUE INDEX jobs_incident_recipient_channel ON jobs(incident_id,recipient_id,channel,trigger) NULLS NOT DISTINCT WHERE incident_id IS NOT NULL;
