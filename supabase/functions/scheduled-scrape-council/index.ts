// Cron wrapper for council meeting scraping.
// Runs 3x daily (8am, 2pm, 8pm UTC) with active-hours gating.

import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";
import { checkScheduleGate } from "../_shared/schedule-gate.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    // Active-hours gate
    const gateResult = await checkScheduleGate(
      supabase, "council_scraper", "scheduled-scrape-council", req, startTime,
    );
    if (gateResult instanceof Response) return gateResult;

    const { currentTimeET } = gateResult;
    console.log(`✅ Schedule gate passed (${currentTimeET} ET) — running council scraper`);

    // Invoke the scraper
    const { data: result, error: invokeError } = await supabase.functions.invoke(
      "scrape-council-meetings",
      { body: {} },
    );

    if (invokeError) {
      throw new Error(`Scraper invocation failed: ${invokeError.message}`);
    }

    const duration = Date.now() - startTime;

    await logCronJob(supabase, {
      job_name: "scheduled-scrape-council",
      schedule_check_passed: true,
      schedule_enabled: true,
      time_checked: currentTimeET,
      execution_duration_ms: duration,
      reason: result?.success
        ? `Parsed ${result.meetingsParsed} meetings, ${result.documentsDetected} new docs, ${result.storiesGenerated}/${result.missingStages} missing stories generated${result.storiesFailed ? ` (${result.storiesFailed} failed)` : ""}`
        : `Scraper error: ${result?.error}`,
    });

    console.log("✅ Scheduled council scrape complete");

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ scheduled-scrape-council error:", msg);

    await logCronJob(supabase, {
      job_name: "scheduled-scrape-council",
      schedule_check_passed: true,
      schedule_enabled: true,
      execution_duration_ms: Date.now() - startTime,
      error_message: msg,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
