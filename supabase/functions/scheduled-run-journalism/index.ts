import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled journalism run triggered at ${now.toISOString()}`);

  const supabase = createSupabaseClient();

  try {
    // Check if AI journalism scheduling is enabled
    const { data: schedule, error: scheduleError } = await supabase
      .from("schedules")
      .select("*")
      .eq("schedule_type", "ai_journalism")
      .maybeSingle();

    if (scheduleError) {
      console.error("❌ Error fetching schedule:", scheduleError);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-run-journalism",
        schedule_check_passed: false,
        reason: "Failed to fetch schedule from database",
        error_message: scheduleError.message,
        execution_duration_ms: duration,
      });
      throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
    }

    if (!schedule) {
      console.log("⚠️ No schedule configured for AI journalism");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-run-journalism",
        schedule_check_passed: false,
        reason: "No schedule configured",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "No schedule configured. Please configure a schedule in the UI."
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    if (!schedule.is_enabled) {
      console.log("⏸️ AI journalism scheduling is disabled");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-run-journalism",
        schedule_check_passed: false,
        schedule_enabled: false,
        scheduled_times: schedule.scheduled_times,
        reason: "Schedule is disabled",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({
          success: false,
          message: "Scheduling is disabled. Enable it in the UI to run scheduled journalism."
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
        job_name: "scheduled-run-journalism",
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

    console.log(`✅ Schedule is enabled and time matches (${currentTimeEST} EST) - running AI journalism`);

    // Fetch the active journalism prompt
    const { data: activePrompt, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("prompt_type", "journalism")
      .eq("is_active", true)
      .single();

    if (promptError || !activePrompt) {
      throw new Error("No active journalism prompt found");
    }

    console.log(`📝 Using active prompt: ${activePrompt.version_name} (${activePrompt.id})`);

    // Set date range to yesterday through end of today in ET (handles EST/EDT automatically)
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const ET_OFFSET_MS = new Date(etStr).getTime() - new Date(utcStr).getTime();
    const estNow = new Date(now.getTime() + ET_OFFSET_MS);

    // Set date range to yesterday through end of today (EST)
    const yesterday = new Date(estNow);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date(estNow);
    today.setHours(23, 59, 59, 999);

    const dateFrom = yesterday;
    const dateTo = today;

    console.log(`📅 Date range: ${dateFrom.toISOString()} to ${dateTo.toISOString()}`);

    // Create a query history record
    const { data: historyRecord, error: historyError } = await supabase
      .from("query_history")
      .insert({
        date_from: dateFrom.toISOString(),
        date_to: dateTo.toISOString(),
        prompt_version_id: activePrompt.id,
        source_ids: [],
        environment: "production",
        run_stages: "automated",
        status: "running",
      })
      .select()
      .single();

    if (historyError || !historyRecord) {
      throw new Error(`Failed to create history record: ${historyError?.message}`);
    }

    console.log(`📊 Created history record: ${historyRecord.id}`);

    // Call run-ai-journalist
    const { data, error } = await supabase.functions.invoke("run-ai-journalist", {
      body: {
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        environment: "production",
        promptVersionId: activePrompt.id,
        historyId: historyRecord.id,
      },
    });

    if (error) {
      // Update history record with error
      await supabase
        .from("query_history")
        .update({
          status: "failed",
          error_message: error.message || "Unknown error",
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyRecord.id);

      throw new Error(`AI Journalist run failed: ${error.message}`);
    }

    console.log("✅ Journalism queue created and processing started:", data);

    const duration = Date.now() - startTime;
    await logCronJob(supabase, {
      job_name: "scheduled-run-journalism",
      schedule_check_passed: true,
      schedule_enabled: true,
      scheduled_times: schedule.scheduled_times,
      query_history_id: historyRecord.id,
      reason: "Successfully started journalism processing",
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        historyId: historyRecord.id,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        promptUsed: activePrompt.version_name,
        result: data,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in scheduled-run-journalism:", error);

    await logCronJob(supabase, {
      job_name: "scheduled-run-journalism",
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
