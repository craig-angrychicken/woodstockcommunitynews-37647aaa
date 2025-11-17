import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    console.log("🕐 Scheduled journalism run triggered at", now.toISOString(), `(${currentTime})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if AI journalism scheduling is enabled and matches current time
    const { data: schedule, error: scheduleError } = await supabase
      .from("schedules")
      .select("*")
      .eq("schedule_type", "ai_journalism")
      .maybeSingle();

    if (scheduleError) {
      console.error("❌ Error fetching schedule:", scheduleError);
      throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
    }

    if (!schedule) {
      console.log("⚠️ No schedule configured for AI journalism");
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
      const [schedHour, schedMin] = time.split(':').map(Number);
      const [currHour, currMin] = [now.getHours(), now.getMinutes()];
      return schedHour === currHour && Math.abs(schedMin - currMin) <= 1;
    });

    if (!isScheduledNow) {
      console.log(`⏰ Not scheduled to run at ${currentTime}. Scheduled times: ${scheduledTimes.join(', ')}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `Not scheduled to run at ${currentTime}. Scheduled times: ${scheduledTimes.join(', ')}` 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log(`✅ Schedule verified - running AI journalism at ${currentTime}`);

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
    console.error("💥 Fatal error in scheduled-run-journalism:", error);
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
