-- Demo mode runs automatic checks only on trips someone is watching: the latest authenticated request per identity.
ALTER TABLE identities ADD COLUMN last_seen_at timestamptz;
