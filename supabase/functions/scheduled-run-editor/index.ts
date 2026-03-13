import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled editor run triggered at ${now.toISOString()}`);

  const supabase = createSupabaseClient();

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

    console.log(`✅ Schedule is enabled and time matches (${currentTimeEST} EST) - running editorial pipeline`);

    // Stage 1: Fact-check pending stories → fact_checked
    console.log("📋 Stage 1: Running fact-checker...");
    const { data: factCheckData, error: factCheckError } = await supabase.functions.invoke("run-ai-fact-checker", {
      body: {},
    });

    if (factCheckError) {
      console.error("⚠️ Fact-checker failed:", factCheckError.message);
    } else {
      console.log("✅ Fact-checker complete:", factCheckData);
    }

    // Stage 2: Rewrite fact-checked stories → edited
    console.log("📋 Stage 2: Running rewriter...");
    const { data: rewriteData, error: rewriteError } = await supabase.functions.invoke("run-ai-rewriter", {
      body: {},
    });

    if (rewriteError) {
      console.error("⚠️ Rewriter failed:", rewriteError.message);
    } else {
      console.log("✅ Rewriter complete:", rewriteData);
    }

    // Stage 3: Editor evaluates edited stories → published/rejected
    console.log("📋 Stage 3: Running editor...");
    const { data: editorData, error: editorError } = await supabase.functions.invoke("run-ai-editor", {
      body: {},
    });

    if (editorError) {
      throw new Error(`AI Editor run failed: ${editorError.message}`);
    }

    console.log("✅ Editor complete:", editorData);

    const duration = Date.now() - startTime;
    const pipelineResult = {
      factChecker: factCheckData || { error: factCheckError?.message },
      rewriter: rewriteData || { error: rewriteError?.message },
      editor: editorData,
    };

    await logCronJob(supabase, {
      job_name: "run-editor",
      schedule_check_passed: true,
      schedule_enabled: true,
      scheduled_times: schedule.scheduled_times,
      reason: "Successfully ran editorial pipeline (3 stages)",
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        result: pipelineResult,
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
