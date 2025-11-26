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

  console.log("🚀 run-ai-journalist started");

  try {
    // Step 0: Environment variable validation
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const queueSecret = Deno.env.get("QUEUE_PROCESSOR_SECRET");
    
    console.log("✅ Environment check:", {
      SUPABASE_URL: supabaseUrl ? "present" : "MISSING",
      SERVICE_ROLE_KEY: supabaseKey ? "present" : "MISSING",
      QUEUE_PROCESSOR_SECRET: queueSecret ? "present" : "MISSING"
    });

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing required environment variables");
    }

    const {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      artifactIds,
    } = await req.json();

    console.log("📋 Request params:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      artifactIds: artifactIds ? `${artifactIds.length} IDs` : "null",
    });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Fetch the prompt version
    console.log(`🔍 Step 1: Fetching prompt version ${promptVersionId}...`);
    const { data: promptVersion, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", promptVersionId)
      .single();

    if (promptError) {
      console.error("❌ Step 1 failed - Prompt fetch error:", promptError);
      throw new Error(`Failed to fetch prompt version: ${promptError.message}`);
    }
    
    if (!promptVersion) {
      console.error("❌ Step 1 failed - Prompt not found");
      throw new Error("Prompt version not found");
    }

    console.log(`✅ Step 1 complete: Prompt "${promptVersion.version_name}" loaded`);

    // Step 2: Fetch artifacts by IDs or date range
    const queryMode = artifactIds && artifactIds.length > 0 ? "by IDs" : "by date range";
    console.log(`🔍 Step 2: Querying artifacts (${queryMode})...`);
    
    if (queryMode === "by date range") {
      console.log(`   - dateFrom: ${dateFrom}`);
      console.log(`   - dateTo: ${dateTo}`);
    } else {
      console.log(`   - artifact IDs: ${artifactIds.length} provided`);
    }
    console.log(`   - environment filter: ${environment} (is_test=${environment === "test"})`);

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

    // Fetch artifacts without applying maxArtifacts limit yet (we'll apply it after filtering)
    const { data: allArtifacts, error: artifactsError } = await artifactsQuery;

    if (artifactsError) {
      console.error("❌ Step 2 failed - Artifacts query error:", artifactsError);
      throw new Error(`Failed to fetch artifacts: ${artifactsError.message}`);
    }

    console.log(`✅ Step 2 complete: Found ${allArtifacts?.length || 0} artifacts`);

    let artifacts = allArtifacts || [];

    // Step 3: Check for duplicates
    if (environment !== "test") {
      console.log("🔍 Step 3: Checking for duplicates...");
      
      const { data: usedArtifacts, error: usedError } = await supabase
        .from('story_artifacts')
        .select('artifact:artifacts(guid)');

      if (usedError) {
        console.error('⚠️ Step 3 warning - Error fetching used artifacts:', usedError);
        console.log("   Continuing anyway - better to process duplicates than fail completely");
      }

      const usedGUIDs = new Set(
        (usedArtifacts || [])
          .map((sa: any) => sa.artifact?.guid)
          .filter((guid: any) => guid != null)
      );
      
      const beforeCount = artifacts.length;
      artifacts = artifacts.filter(a => !usedGUIDs.has(a.guid));
      const afterCount = artifacts.length;
      
      console.log(`✅ Step 3 complete: ${usedGUIDs.size} already used, ${afterCount} remaining (filtered out ${beforeCount - afterCount})`);
    } else {
      console.log(`🧪 Step 3: Test mode - Skipping duplicate check to allow multiple runs`);
    }

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

    // Step 4: Create queue entries for all artifacts
    console.log(`🔍 Step 4: Creating queue with ${artifacts.length} items...`);
    
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
      console.error("❌ Step 4 failed - Queue creation error:", queueError);
      throw new Error(`Failed to create queue: ${queueError.message}`);
    }

    console.log(`✅ Step 4 complete: ${artifacts.length} queue items created`);

    // Step 5: Get the first item to process
    console.log("🔍 Step 5: Fetching first queue item...");
    const { data: firstItem, error: firstItemError } = await supabase
      .from("journalism_queue")
      .select("id")
      .eq("query_history_id", historyId)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .single();

    if (firstItemError) {
      console.error("❌ Step 5 failed - First item fetch error:", firstItemError);
      throw new Error(`Failed to fetch first queue item: ${firstItemError.message}`);
    }
    
    if (!firstItem) {
      console.error("❌ Step 5 failed - No first item found");
      throw new Error("No first queue item found");
    }

    console.log(`✅ Step 5 complete: First item ID ${firstItem.id}`);

    // Step 6: Trigger processing of first item (which will chain to the rest)
    console.log("🔍 Step 6: Starting queue processing...");
    
    if (!queueSecret) {
      console.error("❌ Step 6 failed - QUEUE_PROCESSOR_SECRET not set");
      throw new Error("QUEUE_PROCESSOR_SECRET environment variable not set");
    }

    const { data: invokeData, error: invokeError } = await supabase.functions.invoke("process-journalism-queue-item", {
      body: { queueItemId: firstItem.id },
      headers: { 'x-internal-secret': queueSecret }
    });

    if (invokeError) {
      console.error("❌ Step 6 failed - Queue processing invoke error:", invokeError);
      throw new Error(`Failed to invoke queue processor: ${invokeError.message}`);
    }

    console.log("✅ Step 6 complete: Queue processing invoked successfully");

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
    console.error("💥 Fatal error in run-ai-journalist:", error);
    console.error("   Error details:", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    
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
