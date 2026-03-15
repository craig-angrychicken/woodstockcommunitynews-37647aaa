import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient, getSupabaseUrl, getServiceRoleKey } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🚀 run-ai-journalist started");

  let historyId: string | null = null;

  try {
    // Step 0: Environment variable validation
    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getServiceRoleKey();
    const queueSecret = Deno.env.get("QUEUE_PROCESSOR_SECRET");

    console.log("✅ Environment check:", {
      SUPABASE_URL: supabaseUrl ? "present" : "MISSING",
      SERVICE_ROLE_KEY: supabaseKey ? "present" : "MISSING",
      QUEUE_PROCESSOR_SECRET: queueSecret ? "present" : "MISSING"
    });

    const body = await req.json();
    const {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      artifactIds,
    } = body;
    historyId = body.historyId;

    console.log("📋 Request params:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      artifactIds: artifactIds ? `${artifactIds.length} IDs` : "null",
    });

    const supabase = createSupabaseClient();

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
          .map((sa: Record<string, unknown>) => (sa.artifact as Record<string, unknown> | undefined)?.guid)
          .filter((guid: unknown) => guid != null)
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

    // Step 3b: Group by cluster — queue one item per cluster (representative artifact)
    console.log("🔗 Step 3b: Grouping artifacts by cluster...");

    const clustered = new Map<string, typeof artifacts>();
    const unclustered: typeof artifacts = [];

    for (const artifact of artifacts) {
      if (artifact.cluster_id) {
        const existing = clustered.get(artifact.cluster_id) || [];
        existing.push(artifact);
        clustered.set(artifact.cluster_id, existing);
      } else {
        unclustered.push(artifact);
      }
    }

    // For each cluster, pick the most recent artifact as the representative
    const representativeArtifacts: typeof artifacts = [];
    for (const [clusterId, clusterArtifacts] of clustered) {
      const sorted = clusterArtifacts.sort((a, b) =>
        new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
      );
      representativeArtifacts.push(sorted[0]);
      if (clusterArtifacts.length > 1) {
        console.log(`   Cluster ${clusterId.substring(0, 8)}: ${clusterArtifacts.length} artifacts → using "${sorted[0].title?.substring(0, 60) || sorted[0].id}"`);
      }
    }

    // Combine: representatives + unclustered artifacts
    const artifactsToQueue = [...representativeArtifacts, ...unclustered];
    console.log(`✅ Step 3b complete: ${artifacts.length} artifacts → ${artifactsToQueue.length} queue items (${clustered.size} clusters, ${unclustered.length} unclustered)`);

    // Step 4: Create queue entries for all artifacts
    console.log(`🔍 Step 4: Creating queue with ${artifactsToQueue.length} items...`);

    const queueEntries = artifactsToQueue.map((artifact, index) => ({
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

    console.log(`✅ Step 4 complete: ${artifactsToQueue.length} queue items created`);

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

    // Fire-and-forget: kick off the first item without awaiting the chain
    fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseKey}`,
        "x-internal-secret": queueSecret,
      },
      body: JSON.stringify({ queueItemId: firstItem.id }),
    }).catch(err => console.warn("Chain invoke error (non-fatal):", err?.message));

    console.log("✅ Step 6 complete: Queue processing kicked off (fire-and-forget)");

    // Return immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        success: true,
        message: "AI Journalist queue created and processing started",
        historyId,
        queueSize: artifactsToQueue.length,
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

    // Mark history record as failed so it doesn't stay 'running' forever
    if (historyId) {
      try {
        const supabase = createSupabaseClient();
        await supabase
          .from("query_history")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", historyId);
      } catch (updateError) {
        console.error("Failed to update history status:", updateError);
      }
    }

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
