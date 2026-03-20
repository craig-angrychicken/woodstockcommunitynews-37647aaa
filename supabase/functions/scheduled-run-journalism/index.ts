import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";
import { checkScheduleGate } from "../_shared/schedule-gate.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled journalism run triggered at ${now.toISOString()}`);

  const supabase = createSupabaseClient();

  try {
    // Active-hours gate (replaces old specific-time matching)
    const gateResult = await checkScheduleGate(
      supabase, "ai_journalism", "scheduled-run-journalism", req, startTime,
    );
    if (gateResult instanceof Response) return gateResult;

    const { schedule, currentTimeET } = gateResult;

    console.log(`✅ Schedule gate passed (${currentTimeET} ET) - checking for overlap`);

    // Overlap guard: skip if a previous automated journalism run is still active
    const { data: runningRuns, error: overlapError } = await supabase
      .from("query_history")
      .select("id, created_at")
      .eq("status", "running")
      .eq("run_stages", "automated")
      .not("prompt_version_id", "is", null);

    if (overlapError) {
      console.warn("⚠️ Could not check for overlap:", overlapError.message);
    } else if (runningRuns && runningRuns.length > 0) {
      console.log(`⏭️ Skipping — ${runningRuns.length} automated journalism run(s) still active`);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-run-journalism",
        schedule_check_passed: true,
        schedule_enabled: true,
        time_checked: currentTimeET,
        reason: `Skipped: ${runningRuns.length} run(s) still active (ids: ${runningRuns.map(r => r.id).join(", ")})`,
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: false, message: "Previous run still active, skipping" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    console.log(`✅ No overlap detected — running AI journalism`);

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
      time_checked: currentTimeET,
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
