import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      maxArtifacts,
      artifactIds,
    } = await req.json();

    console.log("AI Journalist run started:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      maxArtifacts,
      artifactIds,
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the prompt version
    const { data: promptVersion, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", promptVersionId)
      .single();

    if (promptError || !promptVersion) {
      throw new Error("Failed to fetch prompt version");
    }

    // Fetch artifacts by IDs or date range
    let artifactsQuery = supabase
      .from("artifacts")
      .select("*");

    if (artifactIds && artifactIds.length > 0) {
      // Use specific artifact IDs
      artifactsQuery = artifactsQuery.in("id", artifactIds);
    } else {
      // Use date range
      artifactsQuery = artifactsQuery
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false });
    }

    if (environment === "test") {
      artifactsQuery = artifactsQuery.eq("is_test", true);
    } else {
      artifactsQuery = artifactsQuery.eq("is_test", false);
    }

    // Get all artifact IDs that are already used in stories
    const { data: usedArtifacts, error: usedError } = await supabase
      .from('story_artifacts')
      .select('artifact_id');

    if (usedError) {
      console.error('⚠️ Error fetching used artifacts:', usedError);
      // Continue anyway - better to process duplicates than fail completely
    }

    const usedArtifactIds = new Set(usedArtifacts?.map(sa => sa.artifact_id) || []);
    console.log(`📊 Found ${usedArtifactIds.size} artifacts already used in stories`);

    // Fetch artifacts without applying maxArtifacts limit yet (we'll apply it after filtering)
    const { data: allArtifacts, error: artifactsError } = await artifactsQuery;

    if (artifactsError) {
      throw new Error(`Failed to fetch artifacts: ${artifactsError.message}`);
    }

    // Filter out artifacts that are already used in stories
    let artifacts = allArtifacts?.filter(a => !usedArtifactIds.has(a.id)) || [];

    // Apply maxArtifacts limit AFTER filtering (only if not using specific artifact IDs)
    if (maxArtifacts && (!artifactIds || artifactIds.length === 0) && artifacts.length > maxArtifacts) {
      artifacts = artifacts.slice(0, maxArtifacts);
    }

    console.log(`📊 Queue setup:`);
    console.log(`  - Total artifacts found: ${allArtifacts?.length || 0}`);
    console.log(`  - Already used (filtered out): ${(allArtifacts?.length || 0) - artifacts.length}`);
    console.log(`  - Queue size: ${artifacts.length}`);

    if (!artifacts || artifacts.length === 0) {
      await supabase
        .from("query_history")
        .update({
          status: "completed",
          stories_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No artifacts found",
          historyId,
        }),
        { 
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Create queue entries for all artifacts
    console.log(`📋 Creating queue with ${artifacts.length} items...`);
    
    const queueEntries = artifacts.map((artifact, index) => ({
      query_history_id: historyId,
      artifact_id: artifact.id,
      position: index + 1,
      status: "pending",
    }));

    const { error: queueError } = await supabase
      .from("journalism_queue")
      .insert(queueEntries);

    if (queueError) {
      throw new Error(`Failed to create queue: ${queueError.message}`);
    }

    console.log(`✅ Queue created with ${artifacts.length} items`);

    // Get the first item to process
    const { data: firstItem, error: firstItemError } = await supabase
      .from("journalism_queue")
      .select("id")
      .eq("query_history_id", historyId)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .single();

    if (firstItemError || !firstItem) {
      throw new Error("Failed to fetch first queue item");
    }

    // Trigger processing of first item (which will chain to the rest)
    console.log("🚀 Starting queue processing...");
    await supabase.functions.invoke("process-journalism-queue-item", {
      body: { queueItemId: firstItem.id },
    });

    // Return immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        success: true,
        message: "AI Journalist queue created and processing started",
        historyId,
        queueSize: artifacts.length,
      }),
      { 
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  } catch (error) {
    console.error("Error in run-ai-journalist:", error);
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
