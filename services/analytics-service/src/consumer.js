import { createClient } from 'redis';
import { insertEvent } from './db.js';

const STREAM = 'analytikul:cost_events';
const GROUP = 'analytics';
const CONSUMER = `analytics-${process.pid}`;
const BLOCK_MS = 5000;
const BATCH = 100;

export async function startConsumer(log) {
  const redis = createClient({ url: process.env.REDIS_URI ?? 'redis://redis:6379/0' });
  redis.on('error', (err) => log(`redis error: ${err.message}`));
  await redis.connect();

  try {
    await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
    log(`created consumer group ${GROUP}`);
  } catch (err) {
    if (!String(err.message).includes('BUSYGROUP')) {
      throw err;
    }
  }

  await reclaimPending(redis, log);

  log(`consuming ${STREAM} as ${CONSUMER}`);
  for (;;) {
    try {
      const res = await redis.xReadGroup(GROUP, CONSUMER, [{ key: STREAM, id: '>' }], {
        COUNT: BATCH,
        BLOCK: BLOCK_MS,
      });
      if (res == null) {
        continue;
      }
      for (const stream of res) {
        for (const entry of stream.messages) {
          try {
            await insertEvent(entry.id, entry.message);
            await redis.xAck(STREAM, GROUP, entry.id);
          } catch (err) {
            log(`event ${entry.id} failed (will retry): ${err.message}`);
          }
        }
      }
    } catch (err) {
      log(`consumer loop error: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Re-process entries stuck in the pending list (e.g. after a crash or a poison batch). */
async function reclaimPending(redis, log) {
  try {
    let cursor = '0-0';
    let claimed = 0;
    for (;;) {
      const res = await redis.xAutoClaim(STREAM, GROUP, CONSUMER, 0, cursor, { COUNT: BATCH });
      if (res == null || res.messages.length === 0) {
        break;
      }
      for (const entry of res.messages) {
        if (entry?.message == null) {
          continue;
        }
        try {
          await insertEvent(entry.id, entry.message);
          await redis.xAck(STREAM, GROUP, entry.id);
          claimed += 1;
        } catch (err) {
          log(`pending ${entry.id} still failing: ${err.message}`);
        }
      }
      cursor = res.nextId;
      if (cursor === '0-0') {
        break;
      }
    }
    if (claimed > 0) {
      log(`recovered ${claimed} pending events`);
    }
  } catch (err) {
    log(`pending reclaim error: ${err.message}`);
  }
}
