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
  
  console.log(`🕐 Scheduled artifact fetch triggered at ${now.toISOString()}`);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Check if artifact fetching scheduling is enabled
    const { data: schedule, error: scheduleError } = await supabase
      .from("schedules")
      .select("*")
      .eq("schedule_type", "artifact_fetch")
      .maybeSingle();

    if (scheduleError) {
      console.error("❌ Error fetching schedule:", scheduleError);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: false,
        reason: "Failed to fetch schedule from database",
        error_message: scheduleError.message,
        execution_duration_ms: duration,
      });
      throw new Error(`Failed to fetch schedule: ${scheduleError.message}`);
    }

    if (!schedule) {
      console.log("⚠️ No schedule configured for artifact fetching");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
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
      console.log("⏸️ Artifact fetching scheduling is disabled");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: false,
        schedule_enabled: false,
        scheduled_times: schedule.scheduled_times,
        reason: "Schedule is disabled",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Scheduling is disabled. Enable it in the UI to run scheduled fetching." 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Calculate current time in EST
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    let estHours = utcHours - 5; // EST is UTC-5
    if (estHours < 0) estHours += 24;
    if (estHours >= 24) estHours -= 24;

    const currentTimeEST = `${estHours.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')}`;

    // Check if current time matches any scheduled time (within 5 minutes tolerance)
    const isScheduledTime = schedule.scheduled_times.some((scheduledTime: string) => {
      const [schedHour, schedMin] = scheduledTime.split(':').map(Number);
      const schedMinutes = schedHour * 60 + schedMin;
      const currentMinutes = estHours * 60 + utcMinutes;
      const diff = Math.abs(currentMinutes - schedMinutes);
      return diff <= 5; // 5 minute tolerance
    });

    if (!isScheduledTime) {
      console.log(`⏭️ Skipping run - current time ${currentTimeEST} EST is not a scheduled time`);
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: false,
        schedule_enabled: true,
        scheduled_times: schedule.scheduled_times,
        time_checked: currentTimeEST,
        reason: `Not scheduled for this time (scheduled: ${schedule.scheduled_times.join(', ')})`,
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: false, message: "Not a scheduled run time" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log(`✅ Schedule is enabled and time matches (${currentTimeEST} EST) - running artifact fetch`);

    // Fetch all active RSS Feed sources
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("*")
      .eq("status", "active")
      .eq("type", "RSS Feed");

    if (sourcesError) {
      throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
    }

    if (!sources || sources.length === 0) {
      console.log("⚠️ No active RSS feed sources found");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: true,
        schedule_enabled: true,
        scheduled_times: schedule.scheduled_times,
        sources_count: 0,
        artifacts_count: 0,
        reason: "No active RSS feed sources found",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: true, message: "No active RSS feed sources to fetch", artifactsCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${sources.length} active RSS feed sources to process`);

    // Calculate TRUE 24-hour window in EST (UTC - 5 hours)
    const EST_OFFSET_HOURS = -5;
    const estNow = new Date(now.getTime() + EST_OFFSET_HOURS * 60 * 60 * 1000);
    
    // True 24 hours back from now
    const dateTo = estNow.toISOString();
    const dateFrom = new Date(estNow.getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    // Format EST times for logging
    const formatEST = (date: Date) => {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes} EST`;
    };
    
    const estDateFrom = new Date(new Date(dateFrom).getTime() + EST_OFFSET_HOURS * 60 * 60 * 1000);
    const estDateTo = new Date(new Date(dateTo).getTime() + EST_OFFSET_HOURS * 60 * 60 * 1000);
    
    console.log(`🕐 Current time: ${formatEST(estNow)}`);
    console.log(`📅 Fetching articles from ${formatEST(estDateFrom)} to ${formatEST(estDateTo)}`);

    // Create a single query history entry for the entire batch
    const sourceIds = sources.map(s => s.id);
    const { data: historyEntry, error: historyError } = await supabase
      .from("query_history")
      .insert({
        prompt_version_id: null,
        environment: "production",
        status: "running",
        date_from: dateFrom,
        date_to: dateTo,
        source_ids: sourceIds,
        sources_total: sources.length,
        sources_processed: 0,
        sources_failed: 0,
        run_stages: "automated",
      })
      .select()
      .single();

    if (historyError) {
      console.error(`❌ Error creating history entry:`, historyError);
      throw new Error(`Failed to create history entry: ${historyError.message}`);
    }

    console.log(`📊 Created history record: ${historyEntry.id}`);

    // Make ONE batch call to fetch-rss-feeds with ALL RSS sources
    console.log(`🔄 Batch fetching ${sources.length} RSS sources...`);
    
    const { data: fetchResult, error: fetchError } = await supabase.functions.invoke('fetch-rss-feeds', {
      body: {
        dateFrom,
        dateTo,
        sourceIds: sourceIds,
        environment: "production",
        queryHistoryId: historyEntry.id
      }
    });

    let totalArtifactsCount = 0;
    let finalStatus = "completed";
    let errorMessage = null;

    if (fetchError) {
      console.error(`❌ Error fetching RSS feeds:`, fetchError);
      errorMessage = fetchError.message;
      finalStatus = "failed";
    } else {
      totalArtifactsCount = fetchResult?.artifactsCreated || 0;
      console.log(`✅ Successfully fetched ${totalArtifactsCount} artifacts`);
    }

    // Finalize query_history entry
    const { error: updateError } = await supabase
      .from("query_history")
      .update({
        status: finalStatus,
        completed_at: new Date().toISOString(),
        artifacts_count: totalArtifactsCount,
        current_source_id: null,
        current_source_name: null,
        error_message: errorMessage
      })
      .eq("id", historyEntry.id);

    if (updateError) {
      console.error(`⚠️ Failed to update history entry:`, updateError);
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: !fetchError,
      timestamp: new Date().toISOString(),
      dateRange: { from: dateFrom, to: dateTo },
      sourcesProcessed: sources.length,
      artifactsCount: totalArtifactsCount,
      historyId: historyEntry.id,
      message: fetchError 
        ? `Failed to fetch RSS feeds: ${errorMessage}`
        : `Processed ${sources.length} RSS sources in batch. Created ${totalArtifactsCount} artifacts.`,
    };

    // Log the cron job execution
    await logCronJob(supabase, {
      job_name: "scheduled-fetch-artifacts",
      schedule_check_passed: true,
      schedule_enabled: true,
      scheduled_times: schedule.scheduled_times,
      time_checked: currentTimeEST,
      sources_count: sources.length,
      artifacts_count: totalArtifactsCount,
      query_history_id: historyEntry.id,
      execution_duration_ms: duration,
      error_message: errorMessage
    });

    console.log("✨ Scheduled fetch completed:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("💥 Fatal error in scheduled-fetch-artifacts:", error);
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
