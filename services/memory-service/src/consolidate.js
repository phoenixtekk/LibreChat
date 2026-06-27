// Daily consolidation (reflection): roll a user's episodes for a local day into one read-only
// markdown daily log. Deterministic + idempotent — re-running a day total-overwrites that day's log.
import { usersWithActivityOn, episodesForDay, upsertDailyLog } from './store.js';

const TZ = process.env.MEMORY_TZ ?? 'UTC';

/** Current local date (YYYY-MM-DD) in the configured timezone. */
export function localDate(tz = TZ, when = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

function buildContent(date, episodes) {
  const lines = [`# Daily Log — ${date}`, ''];
  for (const e of episodes) {
    lines.push(`## ${e.goal?.trim() || 'Session'}`);
    if (e.summary?.trim()) {
      lines.push('', e.summary.trim());
    }
    const bullets = [];
    if (e.efforts?.trim()) {
      bullets.push(`- **Efforts:** ${e.efforts.trim()}`);
    }
    if (e.outcome?.trim()) {
      bullets.push(`- **Outcome:** ${e.outcome.trim()}`);
    }
    if (e.topics?.length) {
      bullets.push(`- **Topics:** ${e.topics.join(', ')}`);
    }
    if (bullets.length) {
      lines.push('', ...bullets);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export async function consolidateDay({ date, tz = TZ } = {}, log) {
  const day = date ?? localDate(tz);
  const users = await usersWithActivityOn({ date: day, tz });
  let written = 0;
  for (const userId of users) {
    try {
      const episodes = await episodesForDay({ userId, date: day, tz });
      if (!episodes.length) {
        continue;
      }
      await upsertDailyLog({
        userId,
        date: day,
        title: `Daily Log — ${day}`,
        content: buildContent(day, episodes),
        episodeIds: episodes.map((e) => e.id),
        source: 'reflection',
      });
      written += 1;
    } catch (err) {
      log?.(`consolidate: user ${userId} failed: ${err.message}`);
    }
  }
  if (users.length) {
    log?.(`consolidate: ${day} -> ${written}/${users.length} users`);
  }
  return written;
}

/** Consolidate the last N local days (used after backfill, and as a rolling catch-up). */
export async function consolidateRecentDays({ days = 7, tz = TZ } = {}, log) {
  const now = Date.now();
  let total = 0;
  for (let i = 0; i <= days; i += 1) {
    const day = localDate(tz, new Date(now - i * 86400000));
    total += await consolidateDay({ date: day, tz }, log);
  }
  return total;
}

export function startConsolidator(log) {
  const intervalMs = Number(process.env.MEMORY_CONSOLIDATE_INTERVAL_MS ?? 60 * 60 * 1000);
  const tick = () => consolidateDay({}, log).catch((e) => log?.(`consolidate tick error: ${e.message}`));
  setTimeout(tick, 60000);
  return setInterval(tick, intervalMs);
}
