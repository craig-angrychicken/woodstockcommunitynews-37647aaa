import type { Env } from "./env";
import { first, insert, toJson } from "./_shared/db";
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
      await fetchArtifacts(env, {});
      await recoverStuckQueueItems(env, {});
      break;
    case "5,20,35,50 * * * *": // cluster artifacts
      await clusterArtifacts(env, { startTime: start });
      break;
    case "10,25,40,55 * * * *": // journalism: build queue + kick serial processing
      await runScheduledJournalism(env, start);
      break;
    case "14,34,54 * * * *": // editorial: fact-check → rewrite → edit
      await runScheduledEditor(env, start);
      break;
    case "0 8,14,20 * * *": // council scrape (3x/day)
      await scrapeMeetings(env);
      break;
    default:
      console.warn(`[cron] no handler for "${controller.cron}"`);
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

  const { firstItemId, queueSize } = await createJournalismQueue(env, historyId, dateFrom, dateTo);
  await kickJournalismQueue(env, firstItemId);
  await logCronJob(env, {
    job_name: "scheduled-run-journalism",
    schedule_check_passed: true,
    query_history_id: historyId,
    artifacts_count: queueSize,
    execution_duration_ms: Date.now() - start,
  });
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
