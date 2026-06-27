// The observer — the heartbeat of the memory engine. On a fixed interval it drains the dirty queue,
// reads each conversation's new messages, refines its inference of "what the user is trying to do"
// via the extractor, and upserts the living episode. Quiet episodes are finalized. An in-process
// guard prevents overlapping runs; per-conversation work is fully isolated.
import {
  claimDirty,
  advanceCursor,
  releaseClaim,
  markCaughtUp,
  getActiveEpisodeState,
  upsertActiveEpisode,
  recordRevision,
  episodesToFinalize,
  finalizeEpisode,
  episodeExistsForConversation,
} from './store.js';
import { readNewMessages, toTranscript, recentConversations } from './mongo.js';
import { extractEpisode } from './extract.js';
import { consolidateRecentDays } from './consolidate.js';

let observing = false;

function goalRepOf({ goal, topics, summary }) {
  return [goal, (topics || []).join(', ')].filter(Boolean).join('\n') || summary || 'session';
}

async function processClaim(claim, log) {
  const userId = claim.user_id;
  const conversationId = claim.conversation_id;
  const messages = await readNewMessages({ conversationId, afterId: claim.cursor_message_id });
  if (messages.length === 0) {
    await markCaughtUp({ userId, conversationId });
    return;
  }
  const newCursor = String(messages[messages.length - 1]._id);
  const prior = await getActiveEpisodeState({ userId, conversationId });
  const priorState = prior
    ? { goal: prior.goal, efforts: prior.efforts, outcome: prior.outcome, topics: prior.topics, summary: prior.summary }
    : null;

  const result = await extractEpisode({ prior: priorState, transcript: toTranscript(messages) });
  if (!result.valid) {
    await recordRevision({ userId, episodeId: prior?.id ?? null, extracted: { rawText: result.rawText }, valid: false });
    await releaseClaim({ userId, conversationId }); // cursor NOT advanced — retry next cycle
    log?.(`observer: invalid extraction for ${conversationId}, will retry`);
    return;
  }

  const ep = result.episode;
  const saved = await upsertActiveEpisode({
    userId,
    conversationId,
    goal: ep.goal,
    efforts: ep.efforts,
    outcome: ep.outcome,
    topics: ep.topics,
    summary: ep.summary,
    sourceTrust: 'user',
  });
  await recordRevision({ userId, episodeId: saved.id, extracted: ep, valid: true });
  await advanceCursor({ userId, conversationId, cursorMessageId: newCursor, claimedAt: claim.claimed_at });
}

async function finalizeQuiet(log) {
  const candidates = await episodesToFinalize({
    quietMinutes: Number(process.env.MEMORY_FINALIZE_MINUTES ?? 30),
  });
  let finalized = 0;
  for (const e of candidates) {
    try {
      await finalizeEpisode({ userId: e.user_id, id: e.id, goalRep: goalRepOf(e) });
      finalized += 1;
    } catch (err) {
      log?.(`observer: finalize ${e.id} failed: ${err.message}`);
    }
  }
  return finalized;
}

export async function runObserverOnce(log) {
  if (observing) {
    log?.('observer: prior run still active, skipping');
    return;
  }
  observing = true;
  try {
    const claims = await claimDirty(Number(process.env.MEMORY_OBSERVE_BATCH ?? 20));
    let ok = 0;
    for (const claim of claims) {
      try {
        await processClaim(claim, log);
        ok += 1;
      } catch (err) {
        log?.(`observer: ${claim.conversation_id} failed: ${err.message}`);
        await releaseClaim({ userId: claim.user_id, conversationId: claim.conversation_id }).catch(() => {});
      }
    }
    const finalized = await finalizeQuiet(log);
    if (claims.length || finalized) {
      log?.(`observer: processed ${ok}/${claims.length}, finalized ${finalized}`);
    }
  } finally {
    observing = false;
  }
}

/** Bounded backfill: seed episodes + logs from a sample of recent conversations. */
export async function backfillRecent({ days = 7, limit = 25 } = {}, log) {
  const convs = await recentConversations({ days, limit });
  let seeded = 0;
  for (const { userId, conversationId } of convs) {
    try {
      if (await episodeExistsForConversation({ userId, conversationId })) {
        continue; // idempotent — already have an episode for this conversation
      }
      const messages = await readNewMessages({ conversationId, afterId: null, limit: 400 });
      if (!messages.length) {
        continue;
      }
      const result = await extractEpisode({ prior: null, transcript: toTranscript(messages) });
      if (!result.valid) {
        continue;
      }
      const ep = result.episode;
      const saved = await upsertActiveEpisode({ userId, conversationId, ...ep, sourceTrust: 'user' });
      await finalizeEpisode({ userId, id: saved.id, goalRep: goalRepOf(ep) });
      seeded += 1;
    } catch (err) {
      log?.(`backfill: ${conversationId} failed: ${err.message}`);
    }
  }
  const logs = await consolidateRecentDays({ days }, log);
  log?.(`backfill: seeded ${seeded}/${convs.length} episodes, wrote ${logs} daily logs`);
  return { seeded, total: convs.length, logs };
}

export function startObserver(log) {
  const intervalMs = Number(process.env.MEMORY_OBSERVE_INTERVAL_MS ?? 15 * 60 * 1000);
  const tick = () => runObserverOnce(log).catch((e) => log?.(`observer tick error: ${e.message}`));
  setTimeout(tick, 30000);
  return setInterval(tick, intervalMs);
}
