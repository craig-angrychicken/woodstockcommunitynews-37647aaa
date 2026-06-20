import type { Env } from "../env";
import type { SourceRow, QueryHistoryRow } from "../_shared/types";
import { all, insert, run } from "../_shared/db";
import { logCronJob } from "../_shared/cron-logger";
import { checkScheduleGate } from "../_shared/schedule-gate";
import { fetchRssFeeds } from "./fetch-rss";
import { fetchWebPages } from "./fetch-web-pages";

export interface FetchArtifactsResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  timestamp?: string;
  dateRange?: { from: string; to: string };
  sourcesProcessed?: number;
  artifactsCount?: number;
  historyId?: string;
  message?: string;
  error?: string;
}

/**
 * Orchestrates the scheduled artifact fetch: schedule-gates on `artifact_fetch`,
 * fetches all active RSS + Web Page sources in parallel, writes a single
 * query_history batch entry, and logs the cron run.
 *
 * Ported from supabase/functions/scheduled-fetch-artifacts. Behavior preserved;
 * the only platform change is calling the in-worker fetchRssFeeds/fetchWebPages
 * helpers directly (in parallel) instead of supabase.functions.invoke.
 */
export async function fetchArtifacts(
  env: Env,
  opts: { force?: boolean } = {},
): Promise<FetchArtifactsResult> {
  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled artifact fetch triggered at ${now.toISOString()}`);

  try {
    // Active-hours gate (replaces old specific-time matching)
    const gateResult = await checkScheduleGate(env, "artifact_fetch", "scheduled-fetch-artifacts", {
      force: opts.force,
      startTime,
    });

    if (!gateResult.passed) {
      // checkScheduleGate already logged the skip to cron_job_logs.
      return { success: true, skipped: true, reason: gateResult.reason };
    }

    const { currentTimeET } = gateResult;

    console.log(`✅ Schedule gate passed (${currentTimeET} ET) - running artifact fetch`);

    // Fetch all active sources by type
    const rssSources = await all<SourceRow>(
      env,
      `select * from sources where status = ? and type = ?`,
      "active",
      "RSS Feed",
    );

    const webPageSources = await all<SourceRow>(
      env,
      `select * from sources where status = ? and type = ?`,
      "active",
      "Web Page",
    );

    const sources = [...rssSources, ...webPageSources];

    if (sources.length === 0) {
      console.log("⚠️ No active sources found");
      const duration = Date.now() - startTime;
      await logCronJob(env, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: true,
        schedule_enabled: true,
        sources_count: 0,
        artifacts_count: 0,
        time_checked: currentTimeET,
        reason: "No active sources found",
        execution_duration_ms: duration,
      });
      return { success: true, message: "No active sources to fetch", artifactsCount: 0 };
    }

    console.log(
      `📊 Found ${rssSources.length} RSS + ${webPageSources.length} Web Page active sources`,
    );

    // Calculate TRUE 24-hour window in ET (handles EST/EDT automatically)
    const utcStr = now.toLocaleString("en-US", { timeZone: "UTC" });
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const ET_OFFSET_MS = new Date(etStr).getTime() - new Date(utcStr).getTime();
    const estNow = new Date(now.getTime() + ET_OFFSET_MS);

    // True 24 hours back from now
    const dateTo = estNow.toISOString();
    const dateFrom = new Date(estNow.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Format ET times for logging
    const formatET = (date: Date) => {
      return (
        date.toLocaleString("en-US", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }) + " ET"
      );
    };

    console.log(`🕐 Current time: ${formatET(now)}`);
    console.log(
      `📅 Fetching articles from ${formatET(new Date(dateFrom))} to ${formatET(new Date(dateTo))}`,
    );

    // Create a single query history entry for the entire batch
    const rssSourceIds = rssSources.map((s) => s.id);
    const webPageSourceIds = webPageSources.map((s) => s.id);
    const sourceIds = [...rssSourceIds, ...webPageSourceIds];

    const historyEntry = await insert<QueryHistoryRow>(env, "query_history", {
      id: crypto.randomUUID(),
      prompt_version_id: null,
      environment: "production",
      status: "running",
      date_from: dateFrom,
      date_to: dateTo,
      source_ids: sourceIds, // insert() JSON-encodes arrays
      sources_total: sources.length,
      sources_processed: 0,
      sources_failed: 0,
      run_stages: "automated",
    });

    if (!historyEntry) {
      console.error(`❌ Error creating history entry`);
      throw new Error("Failed to create history entry");
    }

    console.log(`📊 Created history record: ${historyEntry.id}`);

    let totalArtifactsCount = 0;
    let finalStatus = "completed";
    let errorMessage: string | null = null;

    // Fetch RSS sources + Web Page sources in parallel.
    const [rssOutcome, webOutcome] = await Promise.all([
      rssSourceIds.length > 0
        ? (async () => {
            console.log(`🔄 Batch fetching ${rssSourceIds.length} RSS sources...`);
            const fetchResult = await fetchRssFeeds(env, {
              dateFrom,
              dateTo,
              sourceIds: rssSourceIds,
              environment: "production",
              queryHistoryId: historyEntry.id,
            });
            return { artifactsCreated: fetchResult?.artifactsCreated || 0 };
          })().then(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          )
        : Promise.resolve(null),
      webPageSourceIds.length > 0
        ? (async () => {
            console.log(`🌐 Fetching ${webPageSourceIds.length} Web Page sources...`);
            const webResult = await fetchWebPages(env, {
              sourceIds: webPageSourceIds,
              environment: "production",
              queryHistoryId: historyEntry.id,
            });
            return { artifactsCreated: webResult?.artifactsCreated || 0 };
          })().then(
            (value) => ({ ok: true as const, value }),
            (error) => ({ ok: false as const, error }),
          )
        : Promise.resolve(null),
    ]);

    // Process RSS outcome
    if (rssOutcome) {
      if (rssOutcome.ok) {
        totalArtifactsCount += rssOutcome.value.artifactsCreated;
        console.log(`✅ RSS: fetched ${rssOutcome.value.artifactsCreated} artifacts`);
      } else {
        console.error(`❌ Error fetching RSS feeds:`, rssOutcome.error);
        errorMessage =
          rssOutcome.error instanceof Error ? rssOutcome.error.message : "Unknown error";
        finalStatus = "failed";
      }
    }

    // Process Web Page outcome
    if (webOutcome) {
      if (webOutcome.ok) {
        totalArtifactsCount += webOutcome.value.artifactsCreated;
        console.log(`✅ Web Pages: fetched ${webOutcome.value.artifactsCreated} artifacts`);
      } else {
        console.error(`❌ Error fetching Web Pages:`, webOutcome.error);
        const webErrorMessage =
          webOutcome.error instanceof Error ? webOutcome.error.message : "Unknown error";
        if (!errorMessage) errorMessage = webErrorMessage;
        if (finalStatus !== "failed") finalStatus = "partial";
      }
    }

    // Finalize query_history entry
    try {
      await run(
        env,
        `update query_history
            set status = ?,
                completed_at = ?,
                artifacts_count = ?,
                current_source_id = ?,
                current_source_name = ?,
                error_message = ?
          where id = ?`,
        finalStatus,
        new Date().toISOString(),
        totalArtifactsCount,
        null,
        null,
        errorMessage,
        historyEntry.id,
      );
    } catch (updateError) {
      console.error(`⚠️ Failed to update history entry:`, updateError);
    }

    const duration = Date.now() - startTime;
    const summary: FetchArtifactsResult = {
      success: finalStatus !== "failed",
      timestamp: new Date().toISOString(),
      dateRange: { from: dateFrom, to: dateTo },
      sourcesProcessed: sources.length,
      artifactsCount: totalArtifactsCount,
      historyId: historyEntry.id,
      message: errorMessage
        ? `Errors during fetch: ${errorMessage}`
        : `Processed ${rssSourceIds.length} RSS + ${webPageSourceIds.length} Web Page sources. Created ${totalArtifactsCount} artifacts.`,
    };

    // Log the cron job execution
    await logCronJob(env, {
      job_name: "scheduled-fetch-artifacts",
      schedule_check_passed: true,
      schedule_enabled: true,
      time_checked: currentTimeET,
      sources_count: sources.length,
      artifacts_count: totalArtifactsCount,
      query_history_id: historyEntry.id,
      execution_duration_ms: duration,
      error_message: errorMessage,
    });

    console.log("✨ Scheduled fetch completed:", summary);

    return summary;
  } catch (error) {
    console.error("💥 Fatal error in scheduled-fetch-artifacts:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
