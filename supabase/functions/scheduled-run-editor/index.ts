import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function logCronJob(supabase: any, log: any) {
  try {
    const { error } = await supabase.from("cron_job_logs").insert(log);
    if (error) {
      console.error("Failed to log cron job:", error);
    }
  } catch (err) {
    console.error("Failed to log cron job (exception):", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled editor run triggered at ${now.toISOString()}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Check if AI editor scheduling is enabled
    const { data: schedule, error: scheduleError } = await supabase
      .from("schedules")
      .select("*")
      .eq("schedule_type", "ai_editor")
      .maybeSingle();

    if (scheduleError) {
      console.error("❌ Error fetching schedule:", scheduleError);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "run-editor",
        schedule_check_passed: false,
        reason: "Failed to fetch schedule from database",
        error_message: scheduleError.message,
        execution_duration_ms: duration,
      });
      throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
    }

    if (!schedule) {
      console.log("⚠️ No schedule configured for AI editor");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "run-editor",
        schedule_check_passed: false,
        reason: "No schedule configured",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "No schedule configured. Please configure a schedule in the UI.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (!schedule.is_enabled) {
      console.log("⏸️ AI editor scheduling is disabled");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "run-editor",
        schedule_check_passed: false,
        schedule_enabled: false,
        scheduled_times: schedule.scheduled_times,
        reason: "Schedule is disabled",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "Scheduling is disabled. Enable it in the UI to run scheduled editor.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Calculate current time in ET (handles EST/EDT automatically)
    const etTimeStr = now.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const [etHStr, etMStr] = etTimeStr.split(':');
    const estHours = parseInt(etHStr) % 24;
    const etMinutes = parseInt(etMStr);

    const currentTimeEST = `${estHours.toString().padStart(2, '0')}:${etMinutes.toString().padStart(2, '0')}`;

    // Check if current time matches any scheduled time (within 5 minutes tolerance)
    const isScheduledTime = schedule.scheduled_times?.some((scheduledTime: string) => {
      const [schedHour, schedMin] = scheduledTime.split(':').map(Number);
      const schedMinutes = schedHour * 60 + schedMin;
      const currentMinutes = estHours * 60 + etMinutes;
      const diff = Math.abs(currentMinutes - schedMinutes);
      return diff <= 5; // 5 minute tolerance
    });

    if (!isScheduledTime) {
      console.log(`⏭️ Skipping run - current time ${currentTimeEST} EST is not a scheduled time`);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "run-editor",
        schedule_check_passed: false,
        schedule_enabled: true,
        scheduled_times: schedule.scheduled_times,
        time_checked: currentTimeEST,
        reason: `Not scheduled for this time (scheduled: ${schedule.scheduled_times?.join(', ')})`,
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: false, message: "Not a scheduled run time" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log(`✅ Schedule is enabled and time matches (${currentTimeEST} EST) - running AI editor`);

    // Invoke run-ai-editor
    const { data, error } = await supabase.functions.invoke("run-ai-editor", {
      body: {},
    });

    if (error) {
      throw new Error(`AI Editor run failed: ${error.message}`);
    }

    console.log("✅ AI Editor run complete:", data);

    const duration = Date.now() - startTime;
    await logCronJob(supabase, {
      job_name: "run-editor",
      schedule_check_passed: true,
      schedule_enabled: true,
      scheduled_times: schedule.scheduled_times,
      reason: "Successfully ran AI editor",
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        result: data,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in scheduled-run-editor:", error);

    await logCronJob(supabase, {
      job_name: "run-editor",
      schedule_check_passed: false,
      reason: "Fatal error during execution",
      error_message: error instanceof Error ? error.message : "Unknown error",
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
