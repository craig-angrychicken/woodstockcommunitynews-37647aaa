import type { Env } from "../env";
import type { ScheduleRow } from "../_shared/types";
import { first, toJson } from "../_shared/db";

export interface ManageScheduleArgs {
  scheduleType: ScheduleRow["schedule_type"];
  scheduledTimes: string[];
  isEnabled: boolean;
}

export interface ManageScheduleResult {
  success: boolean;
  schedule: ScheduleRow;
  message: string;
}

/**
 * Upsert a schedule configuration by schedule_type.
 *
 * Persists the set of scheduled times and the enabled flag for a given schedule
 * type. Actual cron wiring is configured separately; this just saves the
 * configuration that cron jobs read to decide when to run.
 */
export async function manageSchedule(
  env: Env,
  { scheduleType, scheduledTimes, isEnabled }: ManageScheduleArgs,
): Promise<ManageScheduleResult> {
  console.log(`📅 Managing schedule for ${scheduleType}:`, {
    times: scheduledTimes,
    enabled: isEnabled,
  });

  const now = new Date().toISOString();

  // Upsert schedule configuration in the database, keyed on schedule_type.
  // scheduled_times is a JSON TEXT column; is_enabled is INTEGER 0/1.
  const schedule = await first<ScheduleRow>(
    env,
    `insert into schedules (id, schedule_type, scheduled_times, is_enabled, created_at, updated_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict(schedule_type) do update set
       scheduled_times = excluded.scheduled_times,
       is_enabled = excluded.is_enabled,
       updated_at = ?
     returning *`,
    crypto.randomUUID(),
    scheduleType,
    toJson(scheduledTimes),
    isEnabled ? 1 : 0,
    now,
    now,
    now,
  );

  if (!schedule) {
    throw new Error("Failed to upsert schedule");
  }

  console.log("✅ Schedule saved to database:", schedule);

  // Note: Actual cron job scheduling needs to be configured separately.
  // The schedule configuration is now saved and can be used by cron jobs
  // to determine when to run.

  return {
    success: true,
    schedule,
    message: isEnabled && scheduledTimes.length > 0
      ? `Schedule configured with ${scheduledTimes.length} time(s). Cron jobs need to be set up separately.`
      : "Schedule saved but disabled or empty",
  };
}
