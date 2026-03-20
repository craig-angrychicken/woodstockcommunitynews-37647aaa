import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";
import { logCronJob } from "./cron-logger.ts";

interface GatePass {
  schedule: Record<string, unknown>;
  currentTimeET: string;
  body: Record<string, unknown>;
}

/**
 * Shared active-hours gate for scheduled edge functions.
 * Replaces the repeated ~40-line schedule-check pattern.
 *
 * Returns a Response (skip) or a GatePass (proceed).
 */
export async function checkScheduleGate(
  supabase: SupabaseClient,
  scheduleType: string,
  jobName: string,
  req: Request,
  startTime: number,
): Promise<Response | GatePass> {
  const now = new Date();

  // Fetch schedule row
  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("*")
    .eq("schedule_type", scheduleType)
    .maybeSingle();

  if (scheduleError) {
    console.error("❌ Error fetching schedule:", scheduleError);
    await logCronJob(supabase, {
      job_name: jobName,
      schedule_check_passed: false,
      reason: "Failed to fetch schedule from database",
      error_message: scheduleError.message,
      execution_duration_ms: Date.now() - startTime,
    });
    throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
  }

  if (!schedule) {
    console.log(`⚠️ No schedule configured for ${scheduleType}`);
    await logCronJob(supabase, {
      job_name: jobName,
      schedule_check_passed: false,
      reason: "No schedule configured",
      execution_duration_ms: Date.now() - startTime,
    });
    return new Response(
      JSON.stringify({
        success: false,
        message: "No schedule configured. Please configure a schedule in the UI.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }

  if (!schedule.is_enabled) {
    console.log(`⏸️ ${scheduleType} scheduling is disabled`);
    await logCronJob(supabase, {
      job_name: jobName,
      schedule_check_passed: false,
      schedule_enabled: false,
      reason: "Schedule is disabled",
      execution_duration_ms: Date.now() - startTime,
    });
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scheduling is disabled. Enable it in the UI.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }

  // Calculate current ET hour and formatted time
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

  // Allow force bypass (used by pipeline monitor agent for corrective actions)
  const body = await req.json().catch(() => ({}));
  const forceRun = body?.force === true;

  // Active-hours check
  const activeStart = schedule.active_hour_start ?? 6;
  const activeEnd = schedule.active_hour_end ?? 22;
  const inActiveHours = etHour >= activeStart && etHour < activeEnd;

  if (!inActiveHours && !forceRun) {
    console.log(
      `⏭️ Skipping ${jobName} — current ET hour ${etHour} is outside active hours ${activeStart}-${activeEnd}`,
    );
    await logCronJob(supabase, {
      job_name: jobName,
      schedule_check_passed: false,
      schedule_enabled: true,
      time_checked: currentTimeET,
      reason: `Outside active hours (${activeStart}:00-${activeEnd}:00 ET, current: ${currentTimeET})`,
      execution_duration_ms: Date.now() - startTime,
    });
    return new Response(
      JSON.stringify({ success: false, message: "Outside active hours" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  }

  console.log(
    `✅ ${jobName} gate passed (${currentTimeET} ET, active ${activeStart}-${activeEnd})${forceRun ? " [forced]" : ""}`,
  );

  return { schedule, currentTimeET, body };
}
