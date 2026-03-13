import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  console.log(`🕐 Scheduled queue recovery triggered at ${new Date().toISOString()}`);

  const supabase = createSupabaseClient();

  try {
    // Invoke the recovery function
    const { data, error } = await supabase.functions.invoke("recover-stuck-queue-items", {
      body: {},
    });

    if (error) {
      throw new Error(`Recovery function failed: ${error.message}`);
    }

    console.log("✅ Queue recovery complete:", data);

    const duration = Date.now() - startTime;
    await logCronJob(supabase, {
      job_name: "scheduled-recover-queue",
      reason: "Successfully ran queue recovery",
      result: data,
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({ success: true, result: data }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in scheduled-recover-queue:", error);

    await logCronJob(supabase, {
      job_name: "scheduled-recover-queue",
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
