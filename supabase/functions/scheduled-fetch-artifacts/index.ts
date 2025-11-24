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

    // Fetch all active sources
    const { data: sources, error: sourcesError } = await supabase
      .from("sources")
      .select("*")
      .eq("status", "active");

    if (sourcesError) {
      throw new Error(`Failed to fetch sources: ${sourcesError.message}`);
    }

    if (!sources || sources.length === 0) {
      console.log("⚠️ No active sources found");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "scheduled-fetch-artifacts",
        schedule_check_passed: true,
        schedule_enabled: true,
        scheduled_times: schedule.scheduled_times,
        sources_count: 0,
        artifacts_count: 0,
        reason: "No active sources found",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: true, message: "No active sources to fetch", artifactsCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${sources.length} active sources to process`);

    // Calculate dates in EST (UTC - 5 hours)
    const EST_OFFSET_HOURS = -5;
    const estNow = new Date(now.getTime() + EST_OFFSET_HOURS * 60 * 60 * 1000);
    
    // Set date range to yesterday through end of today (EST)
    const yesterday = new Date(estNow);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date(estNow);
    today.setHours(23, 59, 59, 999);
    
    const dateFrom = yesterday.toISOString();
    const dateTo = today.toISOString();
    
    // Format EST times for logging
    const formatEST = (date: Date) => {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes} EST`;
    };
    
    console.log(`🕐 Current time: ${formatEST(estNow)}`);
    console.log(`📅 Fetching articles from ${formatEST(yesterday)} to ${formatEST(today)}`);

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

    // Call run-manual-query for each source to actually fetch and save artifacts
    let totalArtifactsCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const source of sources) {
      try {
        console.log(`🔄 Fetching artifacts from: ${source.name} (${source.id})`);
        
        // Update current source being processed
        await supabase
          .from("query_history")
          .update({
            current_source_id: source.id,
            current_source_name: source.name,
          })
          .eq("id", historyEntry.id);

        // Call the appropriate function based on source type
        const isRSSFeed = source.type === "RSS Feed";
        const functionName = isRSSFeed ? "fetch-rss-feeds" : "run-manual-query";
        
        const requestBody = isRSSFeed 
          ? {
              dateFrom,
              dateTo,
              sourceIds: [source.id],
              environment: "production",
              queryHistoryId: historyEntry.id
            }
          : {
              dateFrom,
              dateTo,
              sourceIds: [source.id],
              environment: "production",
              promptVersionId: null,
              runStages: { fetchArtifacts: true, generateStories: false },
              historyId: historyEntry.id,
              maxArticles: 10
            };

        const { data, error } = await supabase.functions.invoke(functionName, {
          body: requestBody,
        });

        if (error) {
          console.error(`❌ Error fetching from ${source.name}:`, error);
          errorCount++;
          
          // Update progress
          await supabase
            .from("query_history")
            .update({ 
              sources_processed: successCount + errorCount,
              sources_failed: errorCount,
            })
            .eq("id", historyEntry.id);
        } else {
          // RSS feeds return artifactsCreated, scrapers return artifactsCount
          const artifactsCount = isRSSFeed 
            ? (data?.artifactsCreated || 0)
            : (data?.artifactsCount || 0);
          totalArtifactsCount += artifactsCount;
          successCount++;
          console.log(`✅ Successfully fetched ${artifactsCount} artifacts from ${source.name} using ${functionName}`);
          
          // Update progress
          await supabase
            .from("query_history")
            .update({ 
              sources_processed: successCount + errorCount,
              sources_failed: errorCount,
              artifacts_count: totalArtifactsCount,
            })
            .eq("id", historyEntry.id);
        }
      } catch (error) {
        console.error(`❌ Exception processing source ${source.name}:`, error);
        errorCount++;
        
        // Update progress
        await supabase
          .from("query_history")
          .update({ 
            sources_processed: successCount + errorCount,
            sources_failed: errorCount,
          })
          .eq("id", historyEntry.id);
      }
    }

    // Mark history as completed
    await supabase
      .from("query_history")
      .update({
        status: errorCount === sources.length ? "failed" : "completed",
        completed_at: new Date().toISOString(),
        sources_processed: sources.length,
        sources_failed: errorCount,
        artifacts_count: totalArtifactsCount,
        current_source_id: null,
        current_source_name: null,
      })
      .eq("id", historyEntry.id);

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      dateRange: { from: dateFrom, to: dateTo },
      sourcesProcessed: sources.length,
      successCount,
      errorCount,
      artifactsCount: totalArtifactsCount,
      historyId: historyEntry.id,
      message: `Processed ${sources.length} sources: ${successCount} succeeded, ${errorCount} failed. Created ${totalArtifactsCount} artifacts.`,
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
