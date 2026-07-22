-- Analytikul memory engine — Phase 0 foundation (ADR-010 / docs/memory-architecture.md)
-- Idempotent. Run by the ADMIN connection (owner/superuser) at service startup.
--
-- SECURITY NOTE (blocker #1): the runtime role `memory_rt` MUST be LOGIN, NOSUPERUSER,
-- NOBYPASSRLS, and NOT own these tables — otherwise RLS is bypassed and isolation is a no-op.
-- A superuser/BYPASSRLS role (e.g. the bootstrap `myuser`) ignores even FORCE ROW LEVEL SECURITY.
-- Role creation (one-time bootstrap, with a password from env) is done by the service before this
-- script; see store.js ensureRuntimeRole(). This file only creates objects, RLS, and GRANTs.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS memory;

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION memory.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Dirty-queue + cursor (NON-RLS bookkeeping; only the admin role touches it) ─
CREATE TABLE IF NOT EXISTS memory.observer_queue (
  user_id           TEXT NOT NULL,
  conversation_id   TEXT NOT NULL,
  cursor_message_id TEXT,
  dirty_since       TIMESTAMPTZ,
  claimed_at        TIMESTAMPTZ,
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS observer_queue_dirty
  ON memory.observer_queue (dirty_since) WHERE dirty_since IS NOT NULL;

-- ── Episodic (per-user RLS) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory.episodes (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  org_id          TEXT,
  conversation_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  observer_runs   INT  NOT NULL DEFAULT 0,
  goal            TEXT,
  efforts         TEXT,
  outcome         TEXT,
  topics          TEXT[] NOT NULL DEFAULT '{}',
  summary         TEXT NOT NULL,
  source_trust    TEXT NOT NULL DEFAULT 'user',
  importance      REAL NOT NULL DEFAULT 0.5,
  confidence      REAL NOT NULL DEFAULT 0.6,
  access_count    INT  NOT NULL DEFAULT 0,
  last_accessed   TIMESTAMPTZ,
  embedding       vector(384),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS episodes_active_conv
  ON memory.episodes (user_id, conversation_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS episodes_emb_hnsw
  ON memory.episodes USING hnsw (embedding vector_cosine_ops) WHERE status = 'finalized';
CREATE INDEX IF NOT EXISTS episodes_user ON memory.episodes (user_id, created_at DESC);
DROP TRIGGER IF EXISTS episodes_touch ON memory.episodes;
CREATE TRIGGER episodes_touch BEFORE UPDATE ON memory.episodes
  FOR EACH ROW EXECUTE FUNCTION memory.touch_updated_at();

CREATE TABLE IF NOT EXISTS memory.episode_revisions (
  id         BIGSERIAL PRIMARY KEY,
  episode_id BIGINT,
  user_id    TEXT NOT NULL,
  extracted  JSONB NOT NULL,
  valid      BOOLEAN NOT NULL,
  run_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_revisions_ep ON memory.episode_revisions (episode_id);

-- ── Semantic facts (per-user RLS) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory.facts (
  id                BIGSERIAL PRIMARY KEY,
  user_id           TEXT NOT NULL,
  subject           TEXT, predicate TEXT, object TEXT,
  source_trust      TEXT NOT NULL DEFAULT 'user',
  confidence        REAL NOT NULL DEFAULT 0.6,
  importance        REAL NOT NULL DEFAULT 0.5,
  source_episode_id BIGINT,
  embedding         vector(384) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facts_emb_hnsw ON memory.facts USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS facts_user ON memory.facts (user_id);
DROP TRIGGER IF EXISTS facts_touch ON memory.facts;
CREATE TRIGGER facts_touch BEFORE UPDATE ON memory.facts
  FOR EACH ROW EXECUTE FUNCTION memory.touch_updated_at();

-- ── Procedural (typed, allow-listed; per-user RLS) ────────────────────────────
CREATE TABLE IF NOT EXISTS memory.procedures (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  dimension    TEXT NOT NULL,
  value        TEXT NOT NULL,
  source_trust TEXT NOT NULL DEFAULT 'user',
  priority     INT  NOT NULL DEFAULT 0,
  confidence   REAL NOT NULL DEFAULT 0.6,
  last_used    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, dimension)
);

-- ── Daily logs (read-only to users; per-user RLS; tz-aware log_date) ──────────
CREATE TABLE IF NOT EXISTS memory.daily_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  log_date    DATE NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  episode_ids BIGINT[] NOT NULL DEFAULT '{}',
  source      TEXT NOT NULL DEFAULT 'reflection',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, log_date)
);
CREATE INDEX IF NOT EXISTS daily_logs_user ON memory.daily_logs (user_id, log_date DESC);
DROP TRIGGER IF EXISTS daily_logs_touch ON memory.daily_logs;
CREATE TRIGGER daily_logs_touch BEFORE UPDATE ON memory.daily_logs
  FOR EACH ROW EXECUTE FUNCTION memory.touch_updated_at();

-- ── Graph + audit ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory.relationships (
  id        BIGSERIAL PRIMARY KEY,
  user_id   TEXT NOT NULL,
  source_id BIGINT, target_id BIGINT, relation TEXT
);
CREATE INDEX IF NOT EXISTS relationships_user ON memory.relationships (user_id);
CREATE TABLE IF NOT EXISTS memory.consolidation_log (
  id BIGSERIAL PRIMARY KEY, user_id TEXT, job TEXT, log_date DATE,
  input_count INT, output_count INT, run_at TIMESTAMPTZ DEFAULT now()
);

-- ── Per-user RLS (app.user_id). FORCE so even the table owner is subject to it. ─
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['episodes','episode_revisions','facts','procedures','daily_logs','relationships']
  LOOP
    EXECUTE format('ALTER TABLE memory.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE memory.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS user_isolation ON memory.%I', t);
    EXECUTE format($p$CREATE POLICY user_isolation ON memory.%I
      USING (user_id = current_setting('app.user_id', true))
      WITH CHECK (user_id = current_setting('app.user_id', true))$p$, t);
  END LOOP;
END $$;

-- ── GRANTs to the least-privilege runtime role (assumes memory_rt exists) ──────
GRANT USAGE ON SCHEMA memory TO memory_rt;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA memory TO memory_rt;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA memory TO memory_rt;
ALTER DEFAULT PRIVILEGES IN SCHEMA memory
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO memory_rt;
ALTER DEFAULT PRIVILEGES IN SCHEMA memory
  GRANT USAGE, SELECT ON SEQUENCES TO memory_rt;
-- observer_queue is admin-only bookkeeping: explicitly REVOKE from the runtime role.
REVOKE ALL ON memory.observer_queue FROM memory_rt;

-- ── Fix the EXISTING org leak: route org_memory.memories runtime access through
-- memory_rt too, so its RLS policy actually enforces (it currently relies on RLS
-- that the bypassing bootstrap role ignores). Grant DML; RLS already exists. ────
GRANT USAGE ON SCHEMA org_memory TO memory_rt;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_memory.memories TO memory_rt;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA org_memory TO memory_rt;
