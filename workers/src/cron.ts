import type { Env } from "./env";
import { first, insert, toJson, run } from "./_shared/db";
import { checkScheduleGate } from "./_shared/schedule-gate";
import { logCronJob } from "./_shared/cron-logger";
import type { PromptVersionRow } from "./_shared/types";
import { fetchArtifacts } from "./pipeline/fetch-artifacts";
import { clusterArtifacts } from "./pipeline/cluster-artifacts";
import { recoverStuckQueueItems } from "./pipeline/queue-recovery";
import { runEditorialPipeline } from "./pipeline/editorial-pipeline";
import { scrapeMeetings } from "./pipeline/council";
import { createJournalismQueue } from "./pipeline/journalism-queue";
import { kickJournalismQueue } from "./queue";

/**
 * Cron Triggers dispatcher. Routes each cron
 * expression (from wrangler.jsonc triggers.crons) to the matching pipeline step.
 * fetch/cluster gate internally on 'artifact_fetch'; journalism/editor gate here.
 */
export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const start = Date.now();
  switch (controller.cron) {
    case "*/15 * * * *": // fetch artifacts + recover stuck queue items
      await step(env, "scheduled-fetch-artifacts", start, () => fetchArtifacts(env, {}));
      await step(env, "recover-stuck-queue", start, () => recoverStuckQueueItems(env, {}));
      break;
    case "5,20,35,50 * * * *": // cluster artifacts
      await step(env, "cluster-artifacts", start, () => clusterArtifacts(env, { startTime: start }));
      break;
    case "10,25,40,55 * * * *": // journalism: build queue + kick serial processing
      await step(env, "scheduled-run-journalism", start, () => runScheduledJournalism(env, start));
      break;
    case "14,34,54 * * * *": // editorial: fact-check → rewrite → edit
      await step(env, "scheduled-run-editor", start, () => runScheduledEditor(env, start));
      break;
    case "0 8,14,20 * * *": // council scrape (3x/day)
      await step(env, "council-scraper", start, () => runScheduledCouncil(env, start));
      break;
    default:
      console.warn(`[cron] no handler for "${controller.cron}"`);
  }
}

/**
 * Run one cron step inside an error boundary. An uncaught throw becomes a
 * visible `cron_job_logs` row (surfaced by the monitor agent) instead of a
 * silent failure, and one failing step no longer skips the rest of the run.
 */
async function step(env: Env, jobName: string, start: number, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron] ${jobName} failed:`, err);
    await logCronJob(env, {
      job_name: jobName,
      schedule_check_passed: true,
      error_message: message.slice(0, 1000),
      execution_duration_ms: Date.now() - start,
    });
  }
}

async function runScheduledJournalism(env: Env, start: number): Promise<void> {
  const gate = await checkScheduleGate(env, "ai_journalism", "scheduled-run-journalism", { startTime: start });
  if (!gate.passed) return;

  const prompt = await first<Pick<PromptVersionRow, "id">>(
    env,
    `select id from prompt_versions where prompt_type='journalism' and is_active=1 limit 1`,
  );
  const now = new Date();
  const dateTo = now.toISOString();
  const dateFrom = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const historyId = crypto.randomUUID();
  await insert(env, "query_history", {
    id: historyId,
    date_from: dateFrom,
    date_to: dateTo,
    environment: "production",
    prompt_version_id: prompt?.id ?? null,
    source_ids: toJson([]),
    run_stages: "automated",
    status: "running",
  });

  try {
    const { firstItemId, queueSize } = await createJournalismQueue(env, historyId, dateFrom, dateTo);
    await kickJournalismQueue(env, firstItemId);
    await logCronJob(env, {
      job_name: "scheduled-run-journalism",
      schedule_check_passed: true,
      query_history_id: historyId,
      artifacts_count: queueSize,
      execution_duration_ms: Date.now() - start,
    });
  } catch (err) {
    // Don't strand the history row at 'running' if queue build/kick throws.
    await run(env, `update query_history set status='failed' where id=?`, historyId);
    throw err; // re-thrown so the step() wrapper logs it to cron_job_logs
  }
}

async function runScheduledEditor(env: Env, start: number): Promise<void> {
  const gate = await checkScheduleGate(env, "ai_editor", "scheduled-run-editor", { startTime: start });
  if (!gate.passed) return;
  await runEditorialPipeline(env);
  await logCronJob(env, {
    job_name: "scheduled-run-editor",
    schedule_check_passed: true,
    execution_duration_ms: Date.now() - start,
  });
}

async function runScheduledCouncil(env: Env, start: number): Promise<void> {
  // Honor the council_scraper schedule flag + active hours (was previously
  // running ungated and never logging — invisible). The gate logs skips itself.
  const gate = await checkScheduleGate(env, "council_scraper", "council-scraper", { startTime: start });
  if (!gate.passed) return;
  const summary = await scrapeMeetings(env);
  await logCronJob(env, {
    job_name: "council-scraper",
    schedule_check_passed: true,
    stories_count: summary.storiesGenerated ?? 0,
    error_message: summary.success ? null : (summary.error ?? "council scrape failed"),
    execution_duration_ms: Date.now() - start,
  });
}
