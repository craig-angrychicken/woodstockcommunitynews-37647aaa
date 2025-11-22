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
  
  // Get current time in UTC and convert to EST
  // NOTE: All scheduled times in database are stored in EST
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcTime = `${String(utcHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')}`;
  
  // Convert UTC to EST (UTC - 5 hours)
  const estHour = (utcHour - 5 + 24) % 24;
  const currentTimeEST = `${String(estHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')}`;
  
  console.log(`🕐 Scheduled journalism run triggered at ${now.toISOString()} (${utcTime} UTC / ${currentTimeEST} EST)`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Check if AI journalism scheduling is enabled and matches current time
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
        time_checked: currentTimeEST,
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
        time_checked: currentTimeEST,
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
        time_checked: currentTimeEST,
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

    const scheduledTimes = schedule.scheduled_times as string[];
    const isScheduledNow = scheduledTimes.some(time => {
      // Match hour and minute (allow ±1 minute tolerance for cron timing)
      // NOTE: Compare against EST time since scheduled times are stored in EST
      const [schedHour, schedMin] = time.split(':').map(Number);
      const [currHour, currMin] = [estHour, utcMinute];
      return schedHour === currHour && Math.abs(schedMin - currMin) <= 1;
    });

    if (!isScheduledNow) {
      console.log(`⏰ Not scheduled to run at ${currentTimeEST}. Scheduled times: ${scheduledTimes.join(', ')}`);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-run-journalism",
        schedule_check_passed: false,
        schedule_enabled: true,
        scheduled_times: scheduledTimes,
        time_checked: currentTimeEST,
        reason: `Not scheduled for this time (scheduled: ${scheduledTimes.join(', ')})`,
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Not scheduled to run at ${currentTimeEST}. Scheduled times: ${scheduledTimes.join(', ')}` 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log(`✅ Schedule verified - running AI journalism at ${currentTimeEST}`);

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

    // Set date range to yesterday
    const dateTo = new Date();
    dateTo.setHours(0, 0, 0, 0); // Start of today
    
    const dateFrom = new Date(dateTo);
    dateFrom.setDate(dateFrom.getDate() - 1); // Start of yesterday

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
      scheduled_times: scheduledTimes,
      time_checked: currentTimeEST,
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
      time_checked: currentTimeEST,
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
