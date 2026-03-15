import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { generateEmbedding } from "../_shared/llm-client.ts";

const SIMILARITY_THRESHOLD = 0.85;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🔗 Starting artifact clustering...");

  const supabase = createSupabaseClient();

  try {
    const body = await req.json().catch(() => ({}));
    const { dateFrom, dateTo } = body;

    // Fetch unclustered artifacts (no cluster_id)
    let query = supabase
      .from("artifacts")
      .select("id, title, name, date, source_id")
      .is("cluster_id", null)
      .eq("is_test", false)
      .order("date", { ascending: false });

    if (dateFrom) query = query.gte("date", dateFrom);
    if (dateTo) query = query.lte("date", dateTo);

    const { data: artifacts, error: fetchError } = await query.limit(200);

    if (fetchError) {
      throw new Error(`Failed to fetch artifacts: ${fetchError.message}`);
    }

    if (!artifacts || artifacts.length === 0) {
      console.log("✅ No unclustered artifacts found");
      return new Response(
        JSON.stringify({ success: true, clustered: 0, newClusters: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Found ${artifacts.length} unclustered artifacts`);

    // Generate embeddings for each artifact title via OpenRouter
    const embeddingsMap = new Map<string, number[]>();

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      try {
        const embedding = await generateEmbedding(title);
        embeddingsMap.set(artifact.id, embedding);
      } catch (err) {
        console.warn(`⚠️ Embedding generation failed for artifact ${artifact.id}:`, err);
      }
    }

    console.log(`📊 Generated ${embeddingsMap.size} embeddings`);

    // Store embeddings in the database
    for (const [artifactId, embedding] of embeddingsMap) {
      const { error: updateError } = await supabase
        .from("artifacts")
        .update({ embedding: JSON.stringify(embedding) })
        .eq("id", artifactId);

      if (updateError) {
        console.warn(`⚠️ Failed to store embedding for ${artifactId}:`, updateError);
      }
    }

    // Cluster artifacts by cosine similarity using the database RPC
    let newClusters = 0;
    let clusteredCount = 0;

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      const embedding = embeddingsMap.get(artifact.id);
      if (!embedding) continue;

      // Check if already clustered (by a previous iteration in this loop)
      const { data: currentArtifact } = await supabase
        .from("artifacts")
        .select("cluster_id")
        .eq("id", artifact.id)
        .single();

      if (currentArtifact?.cluster_id) continue;

      // Find similar artifacts using cosine similarity via RPC
      const { data: similarArtifacts, error: simError } = await supabase.rpc(
        "match_artifacts_by_embedding",
        {
          query_embedding: JSON.stringify(embedding),
          similarity_threshold: SIMILARITY_THRESHOLD,
          match_count: 10,
        }
      );

      if (simError) {
        console.warn(`⚠️ Similarity search failed for artifact ${artifact.id}: ${simError.message}`);
        continue;
      }

      // Process embedding-based matches
      if (similarArtifacts && similarArtifacts.length > 1) {
        const matchIds = similarArtifacts
          .map((m: Record<string, unknown>) => m.id)
          .filter((id: unknown) => id !== artifact.id);

        if (matchIds.length === 0) continue;

        // Check if any match is already clustered
        const { data: existingClustered } = await supabase
          .from("artifacts")
          .select("id, cluster_id")
          .in("id", matchIds)
          .not("cluster_id", "is", null)
          .limit(1);

        if (existingClustered && existingClustered.length > 0) {
          // Join existing cluster
          const clusterId = existingClustered[0].cluster_id;
          await supabase
            .from("artifacts")
            .update({ cluster_id: clusterId })
            .eq("id", artifact.id);
          clusteredCount++;
        } else {
          // Create new cluster
          const { data: newCluster, error: clusterError } = await supabase
            .from("artifact_clusters")
            .insert({
              representative_title: title,
              artifact_count: matchIds.length + 1,
            })
            .select()
            .single();

          if (!clusterError && newCluster) {
            const allIds = [artifact.id, ...matchIds];
            await supabase
              .from("artifacts")
              .update({ cluster_id: newCluster.id })
              .in("id", allIds);

            newClusters++;
            clusteredCount += allIds.length;
          }
        }
      }
    }

    const summary = {
      success: true,
      totalArtifacts: artifacts.length,
      embeddingsGenerated: embeddingsMap.size,
      newClusters,
      clustered: clusteredCount,
    };

    console.log("✅ Clustering complete:", summary);

    return new Response(
      JSON.stringify(summary),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Fatal error in cluster-artifacts:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
