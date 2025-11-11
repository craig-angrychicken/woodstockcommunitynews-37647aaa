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
    console.log("🕐 Scheduled artifact fetch started at", new Date().toISOString());

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
      return new Response(
        JSON.stringify({ success: true, message: "No active sources to fetch", artifactsCount: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${sources.length} active sources to process`);

    // Set date range to yesterday (since this runs daily at 6 AM)
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
            date_to: dateTo
          })
          .select()
          .single();

        if (historyError) {
          console.error(`❌ Error creating history entry for ${source.name}:`, historyError);
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
