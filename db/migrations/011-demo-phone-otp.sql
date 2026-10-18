-- Demo mode only: SMS codes that bind a contact's own number to a demo persona. The number, the IP and the code are
-- stored only as HMACs keyed with DEMO_PHONE_PEPPER; created_at feeds the per-number, per-IP and daily caps.
CREATE TABLE demo_phone_challenges (
  id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES identities,
  issuance_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  phone_hmac text NOT NULL, ip_hmac text NOT NULL, code_hash text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX demo_phone_challenges_window ON demo_phone_challenges(created_at);
-- Start inserts under its global transaction lock; this sequence is the authoritative issuance order, even when clocks tie.
-- Verify must select the latest row without an expiry filter and retain it after consumption, so older codes cannot revive.
CREATE INDEX demo_phone_challenges_lookup ON demo_phone_challenges(identity_id, phone_hmac, issuance_order DESC);
-- The OTP mark dispatch requires in demo mode. Only POST /v1/demo/phone/verify writes it; seeded personas never get one.
CREATE TABLE demo_phone_verifications (
  identity_id uuid PRIMARY KEY REFERENCES identities, phone text NOT NULL, verified_at timestamptz NOT NULL
);
