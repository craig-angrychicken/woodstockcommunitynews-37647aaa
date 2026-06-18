import type { Env, JournalismMessage } from "./env";
import { first } from "./_shared/db";
import type { JournalismQueueRow } from "./_shared/types";
import { processJournalismQueueItem, updateHistoryProgress } from "./pipeline/journalism-queue";

/**
 * Queue consumer for serial journalism processing (replaces the Supabase
 * fire-and-forget chaining + the recover-queue watchdog's re-kick).
 * Configured max_batch_size=1, max_concurrency=1 → strictly serial.
 * Each message processes one queue item, advances history progress, then
 * enqueues the next pending item in the same run.
 */
export async function handleQueue(
  batch: MessageBatch<JournalismMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const { queueItemId } = msg.body;
    try {
      await processJournalismQueueItem(env, queueItemId);

      const item = await first<Pick<JournalismQueueRow, "query_history_id">>(
        env,
        `select query_history_id from journalism_queue where id = ?`,
        queueItemId,
      );
      if (item) {
        await updateHistoryProgress(env, item.query_history_id);
        const next = await first<Pick<JournalismQueueRow, "id">>(
          env,
          `select id from journalism_queue
             where query_history_id = ? and status = 'pending'
             order by position asc limit 1`,
          item.query_history_id,
        );
        if (next) await env.JOURNALISM_QUEUE.send({ queueItemId: next.id });
      }
      msg.ack();
    } catch (err) {
      console.error(`[queue] item ${queueItemId} failed:`, (err as Error).message);
      msg.retry();
    }
  }
}

/** Enqueue the first pending item of a run to kick off serial processing. */
export async function kickJournalismQueue(env: Env, firstItemId: string | null): Promise<void> {
  if (firstItemId) await env.JOURNALISM_QUEUE.send({ queueItemId: firstItemId });
}
