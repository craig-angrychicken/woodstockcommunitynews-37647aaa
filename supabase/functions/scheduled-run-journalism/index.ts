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
    console.log("🕐 Scheduled journalism run started at", new Date().toISOString());

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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

    // Set date range to yesterday (since this runs at 7am, we want yesterday's news)
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
