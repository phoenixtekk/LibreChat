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

/* ── Observer plumbing (admin pool; cross-user bookkeeping over the non-RLS queue) ───────────── */

/** Atomically claim up to `limit` dirty, unclaimed (or stale-claimed) conversations. */
export async function claimDirty(limit = 20) {
  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `WITH c AS (
         SELECT user_id, conversation_id FROM memory.observer_queue
         WHERE dirty_since IS NOT NULL
           AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
         ORDER BY dirty_since
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE memory.observer_queue q SET claimed_at = now()
       FROM c WHERE q.user_id = c.user_id AND q.conversation_id = c.conversation_id
       RETURNING q.user_id, q.conversation_id, q.cursor_message_id, q.claimed_at`,
      [limit],
    );
    return rows;
  });
}

/** Advance the cursor after a successful observe; keep dirty only if re-marked after we claimed. */
export async function advanceCursor({ userId, conversationId, cursorMessageId, claimedAt }) {
  return withAdmin(async (client) => {
    await client.query(
      `UPDATE memory.observer_queue
       SET cursor_message_id = $3, claimed_at = NULL,
           dirty_since = CASE WHEN dirty_since <= $4 THEN NULL ELSE dirty_since END
       WHERE user_id = $1 AND conversation_id = $2`,
      [userId, conversationId, cursorMessageId, claimedAt],
    );
  });
}

/** Release a claim without advancing (failed/invalid run) — leaves it dirty for retry. */
export async function releaseClaim({ userId, conversationId }) {
  return withAdmin(async (client) => {
    await client.query(
      `UPDATE memory.observer_queue SET claimed_at = NULL WHERE user_id = $1 AND conversation_id = $2`,
      [userId, conversationId],
    );
  });
}

/** Caught up (no new messages): clear dirty + claim, advance cursor if provided. */
export async function markCaughtUp({ userId, conversationId, cursorMessageId }) {
  return withAdmin(async (client) => {
    await client.query(
      `UPDATE memory.observer_queue
       SET dirty_since = NULL, claimed_at = NULL,
           cursor_message_id = COALESCE($3, cursor_message_id)
       WHERE user_id = $1 AND conversation_id = $2`,
      [userId, conversationId, cursorMessageId ?? null],
    );
  });
}

/* ── Per-user episode reads/writes for the observer (runtime pool; RLS enforced) ─────────────── */

export async function getActiveEpisodeState({ userId, conversationId }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, goal, efforts, outcome, topics, summary
       FROM memory.episodes WHERE conversation_id = $1 AND status = 'active'`,
      [conversationId],
    );
    return rows[0] ?? null;
  });
}

export async function episodeExistsForConversation({ userId, conversationId }) {
  return withUser(userId, async (client) => {
    const { rowCount } = await client.query(
      `SELECT 1 FROM memory.episodes WHERE conversation_id = $1 LIMIT 1`,
      [conversationId],
    );
    return rowCount > 0;
  });
}

export async function recordRevision({ userId, episodeId, extracted, valid }) {
  return withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO memory.episode_revisions (episode_id, user_id, extracted, valid)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [episodeId ?? null, userId, JSON.stringify(extracted ?? {}), valid],
    );
  });
}

/** Active episodes quiet long enough to finalize, and not currently dirty (admin scan). */
export async function episodesToFinalize({ quietMinutes = 30, limit = 50 }) {
  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `SELECT e.id, e.user_id, e.goal, e.outcome, e.topics, e.summary
       FROM memory.episodes e
       WHERE e.status = 'active'
         AND e.updated_at < now() - ($1 || ' minutes')::interval
         AND NOT EXISTS (
           SELECT 1 FROM memory.observer_queue q
           WHERE q.user_id = e.user_id AND q.conversation_id = e.conversation_id
             AND q.dirty_since IS NOT NULL
         )
       LIMIT $2`,
      [String(quietMinutes), limit],
    );
    return rows;
  });
}

/** Finalize an episode: embed a bounded goal-representation and flip status (runtime pool). */
export async function finalizeEpisode({ userId, id, goalRep }) {
  const vector = await embed(goalRep || 'session');
  return withUser(userId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE memory.episodes
       SET status = 'finalized', ended_at = updated_at, embedding = $2::vector
       WHERE id = $1 AND status = 'active'`,
      [id, JSON.stringify(vector)],
    );
    return rowCount > 0;
  });
}

/* ── Daily consolidation (reflection) ───────────────────────────────────────────────────────── */

/** Users with episode activity on a given local date (admin scan across users). */
export async function usersWithActivityOn({ date, tz }) {
  return withAdmin(async (client) => {
    const { rows } = await client.query(
      `SELECT DISTINCT user_id FROM memory.episodes
       WHERE (COALESCE(ended_at, updated_at) AT TIME ZONE $2)::date = $1::date`,
      [date, tz],
    );
    return rows.map((r) => r.user_id);
  });
}

export async function episodesForDay({ userId, date, tz }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, goal, efforts, outcome, topics, summary, status,
              COALESCE(ended_at, updated_at) AS at
       FROM memory.episodes
       WHERE (COALESCE(ended_at, updated_at) AT TIME ZONE $2)::date = $1::date
       ORDER BY at ASC`,
      [date, tz],
    );
    return rows;
  });
}

/* ── Semantic facts (Phase 2): dedup by (subject,predicate); confidence grows on repetition ───── */
export async function upsertFact({ userId, subject, predicate, object, confidence, sourceEpisodeId }) {
  const vector = await embed(`${subject} ${predicate} ${object}`);
  return withUser(userId, async (client) => {
    const existing = await client.query(
      `SELECT id, confidence FROM memory.facts WHERE subject = $1 AND predicate = $2 LIMIT 1`,
      [subject, predicate],
    );
    if (existing.rowCount > 0) {
      const grown = Math.min(1, Math.max(existing.rows[0].confidence, confidence ?? 0.6) + 0.1);
      await client.query(
        `UPDATE memory.facts SET object = $2, confidence = $3, embedding = $4::vector, updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, object, grown, JSON.stringify(vector)],
      );
      return { id: existing.rows[0].id, updated: true };
    }
    const { rows } = await client.query(
      `INSERT INTO memory.facts (user_id, subject, predicate, object, confidence, source_episode_id, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector) RETURNING id`,
      [userId, subject, predicate, object, confidence ?? 0.6, sourceEpisodeId ?? null, JSON.stringify(vector)],
    );
    if (sourceEpisodeId) {
      await client.query(
        `INSERT INTO memory.relationships (user_id, source_id, target_id, relation)
         VALUES ($1, $2, $3, 'derived_from')`,
        [userId, rows[0].id, sourceEpisodeId],
      );
    }
    return { id: rows[0].id, updated: false };
  });
}

/* ── Procedural prefs (Phase 3): typed + allow-listed, one row per (user,dimension) ───────────── */
export async function upsertProcedure({ userId, dimension, value, confidence }) {
  return withUser(userId, async (client) => {
    await client.query(
      `INSERT INTO memory.procedures (user_id, dimension, value, confidence, last_used)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, dimension) DO UPDATE
         SET value = EXCLUDED.value,
             confidence = LEAST(1, GREATEST(memory.procedures.confidence, EXCLUDED.confidence) + 0.1),
             last_used = now()`,
      [userId, dimension, value, confidence ?? 0.6],
    );
  });
}

/* ── Retrieval for injection: latest daily-log recap + relevant episodes + facts + prefs ───────── */
export async function retrieveContext({ userId, query, episodeLimit = 3, factLimit = 5 }) {
  const vector = query ? await embed(query) : null;
  return withUser(userId, async (client) => {
    const latestLog =
      (
        await client.query(
          `SELECT log_date, content FROM memory.daily_logs ORDER BY log_date DESC LIMIT 1`,
        )
      ).rows[0] ?? null;
    const procedures = (
      await client.query(
        `SELECT dimension, value FROM memory.procedures ORDER BY priority DESC, confidence DESC`,
      )
    ).rows;
    let episodes = [];
    let facts = [];
    if (vector) {
      episodes = (
        await client.query(
          `SELECT goal, summary, importance, 1 - (embedding <=> $1::vector) AS similarity
           FROM memory.episodes
           WHERE status = 'finalized' AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector LIMIT $2`,
          [JSON.stringify(vector), episodeLimit],
        )
      ).rows;
      facts = (
        await client.query(
          `SELECT subject, predicate, object, confidence,
                  1 - (embedding <=> $1::vector) AS similarity
           FROM memory.facts ORDER BY embedding <=> $1::vector LIMIT $2`,
          [JSON.stringify(vector), factLimit],
        )
      ).rows;
    } else {
      facts = (
        await client.query(
          `SELECT subject, predicate, object, confidence FROM memory.facts
           ORDER BY confidence DESC, updated_at DESC LIMIT $1`,
          [factLimit],
        )
      ).rows;
    }
    return { latestLog, procedures, episodes, facts };
  });
}

/* ── Decay (Phase 4): admin cross-user scan; importance > 0.8 never decays ─────────────────────── */
export async function decayEpisodes({ days = 90, factor = 0.9 }) {
  return withAdmin(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE memory.episodes
       SET importance = GREATEST(0, importance * $2)
       WHERE status = 'finalized' AND importance <= 0.8
         AND COALESCE(last_accessed, ended_at, updated_at) < now() - ($1 || ' days')::interval`,
      [String(days), factor],
    );
    return rowCount;
  });
}

export async function upsertDailyLog({ userId, date, title, content, episodeIds, source }) {
  return withUser(userId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO memory.daily_logs (user_id, log_date, title, content, episode_ids, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, log_date) DO UPDATE
         SET title = EXCLUDED.title, content = EXCLUDED.content,
             episode_ids = EXCLUDED.episode_ids, source = EXCLUDED.source
       RETURNING id, log_date`,
      [userId, date, title, content, episodeIds ?? [], source ?? 'reflection'],
    );
    return rows[0];
  });
}
