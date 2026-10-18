-- Bounded retries after definitive retryable rejections (429/401/402/403): one attempt per job version.
ALTER TABLE jobs ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
ALTER TABLE dispatch_attempts DROP CONSTRAINT dispatch_attempts_job_id_key, ADD CONSTRAINT dispatch_attempts_job_version_key UNIQUE (job_id, job_version);
