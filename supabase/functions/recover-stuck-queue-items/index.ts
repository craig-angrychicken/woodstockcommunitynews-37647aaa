import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient, getSupabaseUrl, getServiceRoleKey } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";

const STUCK_THRESHOLD_MINUTES = 10;
const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  console.log("🔍 Checking for stuck queue items...");

  const supabase = createSupabaseClient();

  try {
    // Find items stuck in 'processing' for longer than threshold
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    const { data: stuckItems, error: queryError } = await supabase
      .from("journalism_queue")
      .select("id, retry_count, query_history_id, started_at")
      .eq("status", "processing")
      .lt("started_at", cutoff);

    if (queryError) {
      throw new Error(`Failed to query stuck items: ${queryError.message}`);
    }

    if (!stuckItems || stuckItems.length === 0) {
      console.log("✅ No stuck queue items found");
      const duration = Date.now() - startTime;
      await logCronJob(supabase, {
        job_name: "recover-stuck-queue-items",
        schedule_check_passed: true,
        reason: "Found 0 stuck items",
        execution_duration_ms: duration,
      });

      return new Response(
        JSON.stringify({ success: true, stuckItems: 0, recovered: 0, failedPermanently: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`⚠️ Found ${stuckItems.length} stuck queue item(s)`);

    let recovered = 0;
    let failedPermanently = 0;

    for (const item of stuckItems) {
      const retryCount = item.retry_count || 0;

      if (retryCount < MAX_RETRIES) {
        // Reset to pending and increment retry count
        const { error: updateError } = await supabase
          .from("journalism_queue")
          .update({
            status: "pending",
            retry_count: retryCount + 1,
            started_at: null,
            error_message: `Recovered from stuck processing (retry ${retryCount + 1}/${MAX_RETRIES})`,
          })
          .eq("id", item.id);

        if (updateError) {
          console.error(`❌ Failed to reset item ${item.id}:`, updateError);
          continue;
        }

        console.log(`🔄 Reset item ${item.id} to pending (retry ${retryCount + 1}/${MAX_RETRIES})`);
        recovered++;

        // Restart processing chain for this history
        try {
          const supabaseUrl = getSupabaseUrl();
          const supabaseKey = getServiceRoleKey();
          const secret = Deno.env.get("QUEUE_PROCESSOR_SECRET");

          if (secret) {
            fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
                "x-internal-secret": secret,
              },
              body: JSON.stringify({ queueItemId: item.id }),
            }).catch(err => console.warn("Chain restart error (non-fatal):", err?.message));

            console.log(`📋 Restarted processing chain for item ${item.id}`);
          } else {
            console.warn("⚠️ QUEUE_PROCESSOR_SECRET not set, cannot restart chain");
          }
        } catch (chainErr) {
          console.warn("Failed to restart chain:", chainErr);
        }
      } else {
        // Max retries exceeded — mark as permanently failed
        const { error: failError } = await supabase
          .from("journalism_queue")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: `Max retries exceeded (${MAX_RETRIES}). Item was stuck in processing ${MAX_RETRIES + 1} times.`,
          })
          .eq("id", item.id);

        if (failError) {
          console.error(`❌ Failed to mark item ${item.id} as failed:`, failError);
          continue;
        }

        console.log(`💀 Item ${item.id} permanently failed after ${MAX_RETRIES} retries`);
        failedPermanently++;
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      stuckItems: stuckItems.length,
      recovered,
      failedPermanently,
    };

    await logCronJob(supabase, {
      job_name: "recover-stuck-queue-items",
      schedule_check_passed: true,
      reason: `Recovered ${recovered}, failed permanently: ${failedPermanently} of ${stuckItems.length} stuck items`,
      execution_duration_ms: duration,
    });

    console.log("✅ Recovery complete:", summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in recover-stuck-queue-items:", error);

    await logCronJob(supabase, {
      job_name: "recover-stuck-queue-items",
      schedule_check_passed: false,
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
