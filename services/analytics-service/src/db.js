import pg from 'pg';

export const pool = new pg.Pool({
  connectionString:
    process.env.ANALYTICS_PG_URI ?? 'postgresql://myuser:mypassword@vectordb:5432/mydatabase',
  max: 5,
});

const MIGRATION = `
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.cost_events (
  id BIGSERIAL PRIMARY KEY,
  stream_id TEXT UNIQUE NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,8),
  priced BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS cost_events_org_ts ON analytics.cost_events (org_id, ts);
CREATE INDEX IF NOT EXISTS cost_events_user_ts ON analytics.cost_events (user_id, ts);

CREATE TABLE IF NOT EXISTS analytics.daily_rollup (
  day DATE NOT NULL,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  calls BIGINT NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (day, org_id, user_id, model, provider)
);

CREATE TABLE IF NOT EXISTS analytics.budgets (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily','monthly')),
  limit_usd NUMERIC(12,4) NOT NULL,
  hard BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, period)
);
`;

export async function migrate() {
  await pool.query(MIGRATION);
}

export async function insertEvent(streamId, fields) {
  const tsSeconds = Number.parseFloat(fields.ts ?? `${Date.now() / 1000}`);
  const costRaw = fields.cost_usd;
  const cost = costRaw == null || costRaw === 'None' || costRaw === '' ? null : Number(costRaw);
  const event = {
    streamId,
    ts: new Date(tsSeconds * 1000),
    orgId: fields.tenant_id || 'default',
    userId: fields.user_id || 'unknown',
    conversationId: fields.conversation_id || 'unknown',
    model: fields.model || 'unknown',
    provider: fields.provider || 'unknown',
    inputTokens: Number(fields.input_tokens ?? 0),
    outputTokens: Number(fields.output_tokens ?? 0),
    cost,
    priced: cost != null,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO analytics.cost_events
         (stream_id, ts, org_id, user_id, conversation_id, model, provider, input_tokens, output_tokens, cost_usd, priced)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (stream_id) DO NOTHING
       RETURNING id`,
      [
        event.streamId,
        event.ts,
        event.orgId,
        event.userId,
        event.conversationId,
        event.model,
        event.provider,
        event.inputTokens,
        event.outputTokens,
        event.cost,
        event.priced,
      ],
    );
    if (inserted.rowCount > 0) {
      await client.query(
        `INSERT INTO analytics.daily_rollup (day, org_id, user_id, model, provider, calls, input_tokens, output_tokens, cost_usd)
         VALUES (DATE($1),$2,$3,$4,$5,1,$6,$7,COALESCE($8::numeric,0))
         ON CONFLICT (day, org_id, user_id, model, provider) DO UPDATE SET
           calls = analytics.daily_rollup.calls + 1,
           input_tokens = analytics.daily_rollup.input_tokens + EXCLUDED.input_tokens,
           output_tokens = analytics.daily_rollup.output_tokens + EXCLUDED.output_tokens,
           cost_usd = analytics.daily_rollup.cost_usd + EXCLUDED.cost_usd`,
        [
          event.ts,
          event.orgId,
          event.userId,
          event.model,
          event.provider,
          event.inputTokens,
          event.outputTokens,
          event.cost,
        ],
      );
    }
    await client.query('COMMIT');
    return inserted.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
