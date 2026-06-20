import type { Env } from "../env";
import { insert } from "./db";

export interface CronLog {
  job_name: string;
  schedule_check_passed: boolean;
  schedule_enabled?: boolean | null;
  scheduled_times?: unknown;
  time_checked?: string | null;
  reason?: string | null;
  query_history_id?: string | null;
  sources_count?: number | null;
  artifacts_count?: number | null;
  stories_count?: number | null;
  error_message?: string | null;
  execution_duration_ms?: number | null;
}

/** Insert a cron_job_logs row (best-effort; never throws). */
export async function logCronJob(env: Env, log: CronLog): Promise<void> {
  try {
    await insert(env, "cron_job_logs", { ...log, triggered_at: new Date().toISOString() });
  } catch (err) {
    console.error("Failed to log cron job:", err);
  }
}
