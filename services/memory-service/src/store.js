import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { embed, EMBEDDING_DIM } from './embedder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHASE0_SQL = fs.readFileSync(path.join(__dirname, '..', 'sql', 'phase0.sql'), 'utf8');

const ADMIN_URI =
  process.env.MEMORY_PG_URI ?? 'postgresql://myuser:mypassword@vectordb:5432/mydatabase';

/**
 * Admin pool — DDL, role management, and the legitimately cross-user jobs (observer-queue scan,
 * decay, consolidation episode-selection). Connects as the privileged bootstrap role.
 */
export const adminPool = new pg.Pool({ connectionString: ADMIN_URI, max: 4 });

/**
 * Runtime pool — least-privilege `memory_rt` (NOSUPERUSER, NOBYPASSRLS). RLS is ENFORCED here, so
 * every per-tenant query (withOrg / withUser) goes through this pool. If MEMORY_PG_RT_URI is unset we
 * fall back to the admin URI but warn loudly, because that role bypasses RLS (isolation would be a
 * no-op — never run prod without MEMORY_PG_RT_URI set).
 */
const RT_URI = process.env.MEMORY_PG_RT_URI ?? ADMIN_URI;
if (!process.env.MEMORY_PG_RT_URI) {
  console.warn(
    '[memory] WARNING: MEMORY_PG_RT_URI unset — per-tenant RLS is NOT enforced (runtime role bypasses RLS). Set it in prod.',
  );
}
export const rtPool = new pg.Pool({ connectionString: RT_URI, max: 6 });

const ORG_MIGRATION = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS org_memory;

CREATE TABLE IF NOT EXISTS org_memory.memories (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  embedding vector(${EMBEDDING_DIM}) NOT NULL,
  source_user_id TEXT NOT NULL,
  source_conversation_id TEXT,
  source_task_id TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memories_embedding_hnsw
  ON org_memory.memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memories_org ON org_memory.memories (org_id, created_at DESC);

ALTER TABLE org_memory.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memory.memories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON org_memory.memories;
CREATE POLICY org_isolation ON org_memory.memories
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));
`;

/** Create or sync the least-privilege runtime role. Password is %L-quoted by Postgres (injection-safe). */
async function ensureRuntimeRole(client) {
  const password = process.env.MEMORY_RT_PASSWORD;
  if (!password) {
    console.warn('[memory] WARNING: MEMORY_RT_PASSWORD unset — skipping memory_rt role creation.');
    return;
  }
  const exists = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'memory_rt'")).rowCount > 0;
  const verb = exists ? 'ALTER' : 'CREATE';
  const { rows } = await client.query(
    `SELECT format('%s ROLE memory_rt LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', $1::text, $2::text) AS ddl`,
    [verb, password],
  );
  await client.query(rows[0].ddl);
}

export async function migrate() {
  const client = await adminPool.connect();
  try {
    await client.query(ORG_MIGRATION);
    await ensureRuntimeRole(client);
    await client.query(PHASE0_SQL);
  } finally {
    client.release();
  }
}

/** Per-org RLS context (existing org memory) — now on the RLS-enforced runtime pool. */
async function withOrg(orgId, fn) {
  const client = await rtPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Per-user RLS context (memory engine) — transaction-local GUC, runtime pool only. */
async function withUser(userId, fn) {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('withUser requires a non-empty userId');
  }
  const client = await rtPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Admin context (cross-user jobs only: queue scan, decay, consolidation selection). */
async function withAdmin(fn) {
  const client = await adminPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function saveMemory({ orgId, content, sourceUserId, sourceConversationId, sourceTaskId, tags }) {
  const vector = await embed(content);
  return withOrg(orgId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO org_memory.memories
         (org_id, content, embedding, source_user_id, source_conversation_id, source_task_id, tags)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        orgId,
        content,
        JSON.stringify(vector),
        sourceUserId,
        sourceConversationId ?? null,
        sourceTaskId ?? null,
        tags ?? [],
      ],
    );
    return rows[0];
  });
}

export async function searchMemories({ orgId, query, limit = 5 }) {
  const vector = await embed(query);
  return withOrg(orgId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, content, source_user_id, source_conversation_id, source_task_id, tags, created_at,
              1 - (embedding <=> $1::vector) AS similarity
       FROM org_memory.memories
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [JSON.stringify(vector), Math.min(limit, 20)],
    );
    return rows;
  });
}

export async function listMemories({ orgId, limit = 50 }) {
  return withOrg(orgId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, content, source_user_id, source_conversation_id, source_task_id, tags, created_at
       FROM org_memory.memories ORDER BY created_at DESC LIMIT $1`,
      [Math.min(limit, 200)],
    );
    return rows;
  });
}

export async function deleteMemory({ orgId, id }) {
  return withOrg(orgId, async (client) => {
    const { rowCount } = await client.query('DELETE FROM org_memory.memories WHERE id = $1', [id]);
    return rowCount > 0;
  });
}

/* ── Memory engine (Phase 0 foundation; per-user RLS) ───────────────────────── */

/** Upsert the single live ('active') episode for a conversation. Embedding stays NULL while active. */
export async function upsertActiveEpisode({ userId, conversationId, goal, efforts, outcome, topics, summary, sourceTrust, importance, confidence }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO memory.episodes
         (user_id, conversation_id, status, started_at, summary, goal, efforts, outcome, topics,
          source_trust, importance, confidence, observer_runs)
       VALUES ($1, $2, 'active', now(), $3, $4, $5, $6, $7, $8, $9, $10, 1)
       ON CONFLICT (user_id, conversation_id) WHERE status = 'active'
       DO UPDATE SET summary = EXCLUDED.summary, goal = EXCLUDED.goal, efforts = EXCLUDED.efforts,
                     outcome = EXCLUDED.outcome, topics = EXCLUDED.topics,
                     importance = EXCLUDED.importance, confidence = EXCLUDED.confidence,
                     observer_runs = memory.episodes.observer_runs + 1
       RETURNING id, status, observer_runs, created_at, updated_at`,
      [
        userId,
        conversationId,
        summary,
        goal ?? null,
        efforts ?? null,
        outcome ?? null,
        topics ?? [],
        sourceTrust ?? 'user',
        importance ?? 0.5,
        confidence ?? 0.6,
      ],
    );
    return rows[0];
  });
}

export async function listEpisodes({ userId, limit = 50 }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, conversation_id, status, goal, summary, topics, importance, confidence,
              observer_runs, started_at, ended_at, created_at, updated_at
       FROM memory.episodes ORDER BY created_at DESC LIMIT $1`,
      [Math.min(limit, 200)],
    );
    return rows;
  });
}

export async function listDailyLogs({ userId, limit = 90 }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, log_date, title, source, created_at, updated_at
       FROM memory.daily_logs ORDER BY log_date DESC LIMIT $1`,
      [Math.min(limit, 365)],
    );
    return rows;
  });
}

export async function getDailyLog({ userId, date }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, log_date, title, content, episode_ids, source, created_at, updated_at
       FROM memory.daily_logs WHERE log_date = $1`,
      [date],
    );
    return rows[0] ?? null;
  });
}

/** Mark a conversation dirty for the observer (admin-only bookkeeping; non-RLS). Best-effort. */
export async function markDirty({ userId, conversationId }) {
  return withAdmin(async (client) => {
    await client.query(
      `INSERT INTO memory.observer_queue (user_id, conversation_id, dirty_since)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, conversation_id) DO UPDATE SET dirty_since = now()`,
      [userId, conversationId],
    );
    return true;
  });
}
