import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { logCronJob } from "../_shared/cron-logger.ts";
import { checkScheduleGate } from "../_shared/schedule-gate.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const now = new Date();

  console.log(`🕐 Scheduled editor run triggered at ${now.toISOString()}`);

  const supabase = createSupabaseClient();

  try {
    // Active-hours gate (replaces old specific-time matching)
    const gateResult = await checkScheduleGate(
      supabase, "ai_editor", "run-editor", req, startTime,
    );
    if (gateResult instanceof Response) return gateResult;

    const { schedule, currentTimeET } = gateResult;

    console.log(`✅ Schedule gate passed (${currentTimeET} ET) - running editorial pipeline`);

    // Stage 1: Fact-check pending stories → fact_checked
    console.log("📋 Stage 1: Running fact-checker...");
    const { data: factCheckData, error: factCheckError } = await supabase.functions.invoke("run-ai-fact-checker", {
      body: {},
    });

    if (factCheckError) {
      console.error("⚠️ Fact-checker failed:", factCheckError.message);
    } else {
      console.log("✅ Fact-checker complete:", factCheckData);
    }

    // Stage 2: Rewrite fact-checked stories → edited
    console.log("📋 Stage 2: Running rewriter...");
    const { data: rewriteData, error: rewriteError } = await supabase.functions.invoke("run-ai-rewriter", {
      body: {},
    });

    if (rewriteError) {
      console.error("⚠️ Rewriter failed:", rewriteError.message);
    } else {
      console.log("✅ Rewriter complete:", rewriteData);
    }

    // Stage 3: Editor evaluates edited stories → published/rejected
    console.log("📋 Stage 3: Running editor...");
    const { data: editorData, error: editorError } = await supabase.functions.invoke("run-ai-editor", {
      body: {},
    });

    if (editorError) {
      throw new Error(`AI Editor run failed: ${editorError.message}`);
    }

    console.log("✅ Editor complete:", editorData);

    const duration = Date.now() - startTime;
    const pipelineResult = {
      factChecker: factCheckData || { error: factCheckError?.message },
      rewriter: rewriteData || { error: rewriteError?.message },
      editor: editorData,
    };

    await logCronJob(supabase, {
      job_name: "run-editor",
      schedule_check_passed: true,
      schedule_enabled: true,
      time_checked: currentTimeET,
      reason: "Successfully ran editorial pipeline (3 stages)",
      execution_duration_ms: duration,
    });

    return new Response(
      JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        result: pipelineResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("💥 Fatal error in scheduled-run-editor:", error);

    await logCronJob(supabase, {
      job_name: "run-editor",
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
