import type { Env } from "../env";
import type { JournalismQueueRow } from "../_shared/types";
import { all, run } from "../_shared/db";
import { logCronJob } from "../_shared/cron-logger";
import { kickJournalismQueue } from "../queue";

const DEFAULT_STUCK_THRESHOLD_MINUTES = 10;
const DEFAULT_MAX_RETRIES = 3;

export interface RecoverStuckQueueItemsOptions {
  stuckThresholdMinutes?: number;
  maxRetries?: number;
}

export interface RecoverStuckQueueItemsResult {
  success: boolean;
  stuckItems: number;
  recovered: number;
  failedPermanently: number;
  error?: string;
}

/**
 * Find journalism_queue items stuck in "processing" past the threshold, reset
 * recoverable ones to "pending" (incrementing retry_count and kicking off the
 * processing chain again), and mark exhausted ones as permanently "failed".
 */
export async function recoverStuckQueueItems(
  env: Env,
  { stuckThresholdMinutes, maxRetries }: RecoverStuckQueueItemsOptions = {},
): Promise<RecoverStuckQueueItemsResult> {
  const STUCK_THRESHOLD_MINUTES = stuckThresholdMinutes ?? DEFAULT_STUCK_THRESHOLD_MINUTES;
  const MAX_RETRIES = maxRetries ?? DEFAULT_MAX_RETRIES;

  const startTime = Date.now();
  console.log("🔍 Checking for stuck queue items...");

  try {
    // Find items stuck in 'processing' for longer than threshold
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    const stuckItems = await all<
      Pick<JournalismQueueRow, "id" | "retry_count" | "query_history_id" | "started_at">
    >(
      env,
      `select id, retry_count, query_history_id, started_at
         from journalism_queue
        where status = 'processing'
          and started_at < ?`,
      cutoff,
    );

    if (!stuckItems || stuckItems.length === 0) {
      console.log("✅ No stuck queue items found");
      const duration = Date.now() - startTime;
      await logCronJob(env, {
        job_name: "recover-stuck-queue-items",
        schedule_check_passed: true,
        reason: "Found 0 stuck items",
        execution_duration_ms: duration,
      });

      return { success: true, stuckItems: 0, recovered: 0, failedPermanently: 0 };
    }

    console.log(`⚠️ Found ${stuckItems.length} stuck queue item(s)`);

    let recovered = 0;
    let failedPermanently = 0;

    for (const item of stuckItems) {
      const retryCount = item.retry_count || 0;

      if (retryCount < MAX_RETRIES) {
        // Reset to pending and increment retry count
        try {
          await run(
            env,
            `update journalism_queue
                set status = 'pending',
                    retry_count = ?,
                    started_at = NULL,
                    error_message = ?
              where id = ?`,
            retryCount + 1,
            `Recovered from stuck processing (retry ${retryCount + 1}/${MAX_RETRIES})`,
            item.id,
          );
        } catch (updateError) {
          console.error(`❌ Failed to reset item ${item.id}:`, updateError);
          continue;
        }

        console.log(`🔄 Reset item ${item.id} to pending (retry ${retryCount + 1}/${MAX_RETRIES})`);
        recovered++;

        // Re-enqueue on the durable serial journalism Queue instead of processing
        // inline. A direct fire-and-forget call here races the Queue consumer
        // (max_concurrency=1) and can create duplicate stories, and is lost if the
        // worker is evicted; re-enqueueing preserves serial, at-least-once delivery.
        try {
          await kickJournalismQueue(env, item.id);
          console.log(`📋 Re-enqueued item ${item.id} on the journalism queue`);
        } catch (chainErr) {
          console.warn("Failed to re-enqueue item:", chainErr);
        }
      } else {
        // Max retries exceeded — mark as permanently failed
        try {
          await run(
            env,
            `update journalism_queue
                set status = 'failed',
                    completed_at = ?,
                    error_message = ?
              where id = ?`,
            new Date().toISOString(),
            `Max retries exceeded (${MAX_RETRIES}). Item was stuck in processing ${MAX_RETRIES + 1} times.`,
            item.id,
          );
        } catch (failError) {
          console.error(`❌ Failed to mark item ${item.id} as failed:`, failError);
          continue;
        }

        console.log(`💀 Item ${item.id} permanently failed after ${MAX_RETRIES} retries`);
        failedPermanently++;
      }
    }

    const duration = Date.now() - startTime;
    const summary: RecoverStuckQueueItemsResult = {
      success: true,
      stuckItems: stuckItems.length,
      recovered,
      failedPermanently,
    };

    await logCronJob(env, {
      job_name: "recover-stuck-queue-items",
      schedule_check_passed: true,
      reason: `Recovered ${recovered}, failed permanently: ${failedPermanently} of ${stuckItems.length} stuck items`,
      execution_duration_ms: duration,
    });

    console.log("✅ Recovery complete:", summary);

    return summary;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in recover-stuck-queue-items:", error);

    await logCronJob(env, {
      job_name: "recover-stuck-queue-items",
      schedule_check_passed: false,
      error_message: error instanceof Error ? error.message : "Unknown error",
      execution_duration_ms: duration,
    });

    return {
      success: false,
      stuckItems: 0,
      recovered: 0,
      failedPermanently: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
