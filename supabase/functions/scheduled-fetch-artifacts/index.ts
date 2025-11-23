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

    console.log(`✅ Schedule is enabled - running artifact fetch`);

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

    // Set date range to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    
    const dateFrom = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD
    const dateTo = today.toISOString().split('T')[0]; // YYYY-MM-DD
    
    console.log(`📅 Fetching articles from ${dateFrom} to ${dateTo}`);

    // Call run-manual-query for each source to actually fetch and save artifacts
    let totalArtifactsCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const source of sources) {
      try {
        console.log(`🔄 Fetching artifacts from: ${source.name} (${source.id})`);
        
        // Create a query history entry for tracking
        const { data: historyEntry, error: historyError } = await supabase
          .from("query_history")
          .insert({
            prompt_version_id: null,
            environment: "production",
            status: "running",
            date_from: dateFrom,
            date_to: dateTo,
            source_ids: [source.id],
            run_stages: "fetch"
          })
          .select()
          .single();

        if (historyError) {
          console.error(`❌ Error creating history entry for ${source.name}:`, {
            error: historyError,
            source: { id: source.id, name: source.name }
          });
          errorCount++;
          continue;
        }

        // Invoke run-manual-query to fetch and save artifacts
        const { data, error } = await supabase.functions.invoke("run-manual-query", {
          body: {
            dateFrom,
            dateTo,
            sourceIds: [source.id],
            environment: "production",
            promptVersionId: null,
            runStages: { fetchArtifacts: true, generateStories: false },
            historyId: historyEntry.id,
            maxArticles: 10
          },
        });

        if (error) {
          console.error(`❌ Error fetching from ${source.name}:`, error);
          errorCount++;
          
          // Update history to failed
          await supabase
            .from("query_history")
            .update({ 
              status: "failed",
              error_message: error.message || "Unknown error"
            })
            .eq("id", historyEntry.id);
        } else {
          const artifactsCount = data?.artifactsCount || 0;
          totalArtifactsCount += artifactsCount;
          successCount++;
          console.log(`✅ Successfully fetched ${artifactsCount} artifacts from ${source.name}`);
        }
      } catch (error) {
        console.error(`❌ Exception processing source ${source.name}:`, error);
        errorCount++;
      }
    }

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      dateRange: { from: dateFrom, to: dateTo },
      sourcesProcessed: sources.length,
      successCount,
      errorCount,
      artifactsCount: totalArtifactsCount,
      message: `Processed ${sources.length} sources: ${successCount} succeeded, ${errorCount} failed. Created ${totalArtifactsCount} artifacts.`,
    };

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
