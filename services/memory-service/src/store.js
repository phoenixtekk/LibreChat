import pg from 'pg';
import { embed, EMBEDDING_DIM } from './embedder.js';

export const pool = new pg.Pool({
  connectionString:
    process.env.MEMORY_PG_URI ?? 'postgresql://myuser:mypassword@vectordb:5432/mydatabase',
  max: 5,
});

const MIGRATION = `
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

export async function migrate() {
  await pool.query(MIGRATION);
}

/** Every query runs inside a transaction with the org RLS context set. */
async function withOrg(orgId, fn) {
  const client = await pool.connect();
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
