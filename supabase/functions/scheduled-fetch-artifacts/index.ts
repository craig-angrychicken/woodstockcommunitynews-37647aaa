import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";
import { checkScheduleGate } from "../_shared/schedule-gate.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled artifact fetch triggered at ${now.toISOString()}`);

  const supabase = createSupabaseClient();

  try {
    // Active-hours gate (replaces old specific-time matching)
    const gateResult = await checkScheduleGate(
      supabase, "artifact_fetch", "scheduled-fetch-artifacts", req, startTime,
    );
    if (gateResult instanceof Response) return gateResult;

    const { schedule, currentTimeET } = gateResult;

    console.log(`✅ Schedule gate passed (${currentTimeET} ET) - running artifact fetch`);

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
        sources_count: 0,
        artifacts_count: 0,
        time_checked: currentTimeET,
        reason: "No active RSS feed sources found",
        execution_duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ success: true, message: "No active RSS feed sources to fetch", artifactsCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${sources.length} active RSS feed sources to process`);

    // Calculate TRUE 24-hour window in ET (handles EST/EDT automatically)
    const utcStr = now.toLocaleString('en-US', { timeZone: 'UTC' });
    const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
    const ET_OFFSET_MS = new Date(etStr).getTime() - new Date(utcStr).getTime();
    const estNow = new Date(now.getTime() + ET_OFFSET_MS);

    // True 24 hours back from now
    const dateTo = estNow.toISOString();
    const dateFrom = new Date(estNow.getTime() - 24 * 60 * 60 * 1000).toISOString();

    // Format ET times for logging
    const formatET = (date: Date) => {
      return date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' ET';
    };

    console.log(`🕐 Current time: ${formatET(now)}`);
    console.log(`📅 Fetching articles from ${formatET(new Date(dateFrom))} to ${formatET(new Date(dateTo))}`);

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
      time_checked: currentTimeET,
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
