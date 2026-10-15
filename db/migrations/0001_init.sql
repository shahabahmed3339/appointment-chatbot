-- 0001_init.sql
-- Core schema for the AI-assisted appointment booking app.
--
-- Design notes:
--  * UUID PKs (gen_random_uuid) avoid leaking row counts and make multi-region
--    inserts cheap. pgcrypto ships with PostgreSQL 13+ as a trusted extension.
--  * "business_id" is present from day one so the schema is SaaS/multi-tenant
--    ready without a later migration. For this prototype every row defaults to a
--    single seeded business, but all queries are scoped by business_id.
--  * Timestamps are TIMESTAMPTZ. Booking logic works in UTC and the UI renders
--    in the browser's local timezone. Storing naive timestamps is the classic
--    scheduling bug, so we avoid it deliberately.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- businesses (multi-tenancy anchor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  timezone   TEXT        NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  full_name     TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'member'
                  CHECK (role IN ('owner', 'member')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email uniqueness is per-business: the same person can be a user of two tenants.
CREATE UNIQUE INDEX IF NOT EXISTS users_business_email_uidx
  ON users (business_id, lower(email));

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM
      ('pending', 'confirmed', 'cancelled', 'completed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS appointments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID               NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT               NOT NULL,
  notes        TEXT,
  starts_at    TIMESTAMPTZ        NOT NULL,
  ends_at      TIMESTAMPTZ        NOT NULL,
  status       appointment_status NOT NULL DEFAULT 'pending',
  -- Provenance matters for analytics and for the "AI vs form" tradeoff story.
  source       TEXT               NOT NULL DEFAULT 'form'
                 CHECK (source IN ('form', 'chat')),
  created_at   TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ        NOT NULL DEFAULT now(),

  CONSTRAINT appointments_time_order CHECK (ends_at > starts_at),
  CONSTRAINT appointments_max_duration CHECK (ends_at <= starts_at + interval '8 hours')
);

-- Prevent double-booking the same user's calendar. btree_gist lets us combine
-- an equality (user_id) with a range overlap in one exclusion constraint, which
-- is enforced by the database rather than by racy application checks.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status IN ('pending', 'confirmed'));

-- Hot path: "my upcoming appointments for this business".
CREATE INDEX IF NOT EXISTS appointments_business_starts_idx
  ON appointments (business_id, starts_at DESC);

CREATE INDEX IF NOT EXISTS appointments_user_starts_idx
  ON appointments (user_id, starts_at DESC);

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL DEFAULT 'New booking conversation',
  status       TEXT        NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'booked', 'abandoned')),
  -- The rolling "booking draft" the AI builds up across turns. Keeping it as
  -- jsonb lets the shape evolve without a migration.
  draft        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx
  ON chat_sessions (user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- chat_messages (conversation history = the LLM's memory)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
  ON chat_messages (session_id, created_at);

-- ---------------------------------------------------------------------------
-- ai_interaction_logs (observability for the AI layer)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_interaction_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID        REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id       UUID        REFERENCES users(id) ON DELETE SET NULL,
  provider      TEXT        NOT NULL DEFAULT 'mistral',
  model         TEXT        NOT NULL,
  latency_ms    INTEGER     NOT NULL,
  outcome       TEXT        NOT NULL CHECK (outcome IN ('extracted', 'clarify', 'failed')),
  request_payload  JSONB,
  response_payload JSONB,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_logs_session_created_idx
  ON ai_interaction_logs (session_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS appointments_set_updated_at ON appointments;
CREATE TRIGGER appointments_set_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS chat_sessions_set_updated_at ON chat_sessions;
CREATE TRIGGER chat_sessions_set_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
