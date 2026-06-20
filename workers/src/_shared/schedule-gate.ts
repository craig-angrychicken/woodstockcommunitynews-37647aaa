import type { Env } from "../env";
import { first } from "./db";
import { logCronJob } from "./cron-logger";

export interface ScheduleRow {
  schedule_type: string;
  is_enabled: number; // SQLite boolean (0/1)
  active_hour_start: number | null;
  active_hour_end: number | null;
  scheduled_times: string | null; // JSON text
  [key: string]: unknown;
}

export interface GateResult {
  passed: boolean;
  reason?: string;
  schedule?: ScheduleRow;
  currentTimeET: string;
}

/**
 * Active-hours gate for scheduled jobs (ported from the Supabase _shared version).
 * Transport-agnostic: returns a plain result so it works from both the Cron Trigger
 * handler and HTTP (force) invocations. Logs skips to cron_job_logs like the original.
 */
export async function checkScheduleGate(
  env: Env,
  scheduleType: string,
  jobName: string,
  opts: { force?: boolean; startTime: number },
): Promise<GateResult> {
  const now = new Date();
  const etTimeStr = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [etHStr, etMStr] = etTimeStr.split(":");
  const etHour = parseInt(etHStr) % 24;
  const etMinute = parseInt(etMStr);
  const currentTimeET = `${etHour.toString().padStart(2, "0")}:${etMinute.toString().padStart(2, "0")}`;

  const schedule = await first<ScheduleRow>(
    env,
    `select * from schedules where schedule_type = ? limit 1`,
    scheduleType,
  );

  if (!schedule) {
    await logCronJob(env, {
      job_name: jobName,
      schedule_check_passed: false,
      reason: "No schedule configured",
      time_checked: currentTimeET,
      execution_duration_ms: Date.now() - opts.startTime,
    });
    return { passed: false, reason: "No schedule configured", currentTimeET };
  }

  if (!schedule.is_enabled) {
    await logCronJob(env, {
      job_name: jobName,
      schedule_check_passed: false,
      schedule_enabled: false,
      reason: "Schedule is disabled",
      time_checked: currentTimeET,
      execution_duration_ms: Date.now() - opts.startTime,
    });
    return { passed: false, reason: "Scheduling is disabled", schedule, currentTimeET };
  }

  const activeStart = schedule.active_hour_start ?? 6;
  const activeEnd = schedule.active_hour_end ?? 22;
  const inActiveHours = etHour >= activeStart && etHour < activeEnd;

  if (!inActiveHours && !opts.force) {
    const reason = `Outside active hours (${activeStart}:00-${activeEnd}:00 ET, current: ${currentTimeET})`;
    await logCronJob(env, {
      job_name: jobName,
      schedule_check_passed: false,
      schedule_enabled: true,
      time_checked: currentTimeET,
      reason,
      execution_duration_ms: Date.now() - opts.startTime,
    });
    return { passed: false, reason, schedule, currentTimeET };
  }

  return { passed: true, schedule, currentTimeET };
}
