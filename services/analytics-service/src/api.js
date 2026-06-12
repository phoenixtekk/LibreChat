import { pool } from './db.js';

const PERIOD_START = {
  daily: "date_trunc('day', now())",
  monthly: "date_trunc('month', now())",
};

export async function handleApi(url, method, body) {
  const path = url.pathname;
  const q = url.searchParams;
  const days = Math.min(Number(q.get('days') ?? 30), 365);
  const orgId = q.get('orgId') ?? 'default';

  if (path === '/health') {
    return { status: 'ok', service: 'analytics-service' };
  }

  if (path === '/summary/daily') {
    const { rows } = await pool.query(
      `SELECT day, SUM(cost_usd)::float AS cost_usd, SUM(calls)::int AS calls,
              SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens
       FROM analytics.daily_rollup
       WHERE org_id = $1 AND day > now() - ($2 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [orgId, days],
    );
    return { days: rows };
  }

  if (path === '/summary/models') {
    const { rows } = await pool.query(
      `SELECT model, provider, SUM(cost_usd)::float AS cost_usd, SUM(calls)::int AS calls,
              SUM(input_tokens)::bigint AS input_tokens, SUM(output_tokens)::bigint AS output_tokens
       FROM analytics.daily_rollup
       WHERE org_id = $1 AND day > now() - ($2 || ' days')::interval
       GROUP BY model, provider ORDER BY SUM(cost_usd) DESC`,
      [orgId, days],
    );
    return { models: rows };
  }

  if (path === '/summary/users') {
    const { rows } = await pool.query(
      `SELECT user_id, SUM(cost_usd)::float AS cost_usd, SUM(calls)::int AS calls
       FROM analytics.daily_rollup
       WHERE org_id = $1 AND day > now() - ($2 || ' days')::interval
       GROUP BY user_id ORDER BY SUM(cost_usd) DESC LIMIT 50`,
      [orgId, days],
    );
    return { users: rows };
  }

  if (path === '/summary/conversations') {
    const userId = q.get('userId');
    const { rows } = await pool.query(
      `SELECT conversation_id, SUM(cost_usd)::float AS cost_usd, COUNT(*)::int AS calls,
              SUM(input_tokens + output_tokens)::bigint AS tokens, MAX(ts) AS last_activity
       FROM analytics.cost_events
       WHERE org_id = $1 AND ($3::text IS NULL OR user_id = $3)
         AND ts > now() - ($2 || ' days')::interval
       GROUP BY conversation_id ORDER BY SUM(cost_usd) DESC NULLS LAST LIMIT 50`,
      [orgId, days, userId],
    );
    return { conversations: rows };
  }

  if (path === '/events/recent') {
    const limit = Math.min(Number(q.get('limit') ?? 50), 200);
    const { rows } = await pool.query(
      `SELECT ts, user_id, conversation_id, model, provider, input_tokens::int, output_tokens::int,
              cost_usd::float, priced
       FROM analytics.cost_events WHERE org_id = $1 ORDER BY ts DESC LIMIT $2`,
      [orgId, limit],
    );
    return { events: rows };
  }

  if (path === '/summary/unpriced') {
    const { rows } = await pool.query(
      `SELECT model, provider, COUNT(*)::int AS calls,
              SUM(input_tokens + output_tokens)::bigint AS tokens
       FROM analytics.cost_events WHERE org_id = $1 AND priced = FALSE
       GROUP BY model, provider ORDER BY calls DESC`,
      [orgId],
    );
    return { unpriced: rows };
  }

  if (path === '/budgets' && method === 'GET') {
    const { rows } = await pool.query(
      `SELECT id, org_id, user_id, period, limit_usd::float, hard FROM analytics.budgets WHERE org_id = $1`,
      [orgId],
    );
    return { budgets: rows };
  }

  if (path === '/budgets' && method === 'POST') {
    const { userId = null, period = 'monthly', limitUsd, hard = true } = body ?? {};
    if (typeof limitUsd !== 'number' || limitUsd < 0) {
      return { error: 'limitUsd (number >= 0) required', _status: 400 };
    }
    const { rows } = await pool.query(
      `INSERT INTO analytics.budgets (org_id, user_id, period, limit_usd, hard)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, user_id, period) DO UPDATE SET limit_usd = EXCLUDED.limit_usd, hard = EXCLUDED.hard
       RETURNING id, org_id, user_id, period, limit_usd::float, hard`,
      [orgId, userId, period, limitUsd, hard],
    );
    return { budget: rows[0] };
  }

  if (path === '/budgets/check') {
    const userId = q.get('userId');
    if (!userId) {
      return { error: 'userId required', _status: 400 };
    }
    const { rows: budgets } = await pool.query(
      `SELECT user_id, period, limit_usd::float, hard FROM analytics.budgets
       WHERE org_id = $1 AND (user_id = $2 OR user_id IS NULL)`,
      [orgId, userId],
    );
    for (const budget of budgets) {
      const since = PERIOD_START[budget.period];
      const scope = budget.user_id == null ? 'org_id = $1' : 'org_id = $1 AND user_id = $2';
      const { rows } = await pool.query(
        `SELECT COALESCE(SUM(cost_usd),0)::float AS spent FROM analytics.cost_events
         WHERE ${scope} AND ts >= ${since}`,
        budget.user_id == null ? [orgId] : [orgId, userId],
      );
      const spent = rows[0].spent;
      if (spent >= budget.limit_usd) {
        return {
          allowed: !budget.hard,
          exceeded: true,
          scope: budget.user_id == null ? 'org' : 'user',
          period: budget.period,
          spent,
          limit: budget.limit_usd,
          hard: budget.hard,
        };
      }
    }
    return { allowed: true, exceeded: false };
  }

  return { error: 'not found', _status: 404 };
}
