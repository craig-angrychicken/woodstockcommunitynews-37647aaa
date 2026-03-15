import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";

const SIMILARITY_THRESHOLD = 0.85;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🔗 Starting artifact clustering...");

  const supabase = createSupabaseClient();

  try {
    const body = await req.json().catch(() => ({}));
    const { dateFrom, dateTo } = body;

    // Fetch unclustered artifacts (no cluster_id and no embedding yet)
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

    // Generate embeddings for titles using Supabase's built-in AI
    // We use a lightweight approach: generate embeddings via the pg function
    // For each artifact, compute embedding from its title
    const embeddingsMap = new Map<string, number[]>();

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      try {
        // Use Supabase's built-in embedding generation via SQL
        const { data: embeddingResult, error: embError } = await supabase.rpc(
          "generate_embedding",
          { input_text: title }
        );

        if (embError) {
          // Fallback: try using OpenRouter for embeddings
          console.warn(`⚠️ Built-in embedding failed for "${title.substring(0, 50)}": ${embError.message}`);

          // Use a simple hash-based approach as fallback
          const simpleEmbedding = await generateSimpleEmbedding(title);
          embeddingsMap.set(artifact.id, simpleEmbedding);
        } else if (embeddingResult) {
          embeddingsMap.set(artifact.id, embeddingResult);
        }
      } catch (err) {
        console.warn(`⚠️ Embedding generation failed for artifact ${artifact.id}:`, err);
        // Use simple embedding as fallback
        const simpleEmbedding = await generateSimpleEmbedding(title);
        embeddingsMap.set(artifact.id, simpleEmbedding);
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

    // Cluster artifacts by similarity using the database
    let newClusters = 0;
    let clusteredCount = 0;

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      // Check if already clustered (by a previous iteration in this loop)
      const { data: currentArtifact } = await supabase
        .from("artifacts")
        .select("cluster_id")
        .eq("id", artifact.id)
        .single();

      if (currentArtifact?.cluster_id) continue;

      // Find similar artifacts using cosine similarity via SQL
      const { data: similarArtifacts, error: simError } = await supabase.rpc(
        "match_artifacts_by_embedding",
        {
          query_embedding: JSON.stringify(embeddingsMap.get(artifact.id) || []),
          similarity_threshold: SIMILARITY_THRESHOLD,
          match_count: 10,
        }
      );

      if (simError) {
        // If the RPC doesn't exist yet, fall back to title-based matching
        console.warn("⚠️ Embedding similarity search failed, using title-based matching");

        // Simple title-based dedup: normalize and compare
        const normalizedTitle = title.toLowerCase().trim().replace(/[^a-z0-9\s]/g, "");
        const words = normalizedTitle.split(/\s+/).filter(w => w.length > 3);

        if (words.length < 2) continue;

        // Search for artifacts with similar titles
        const searchTerms = words.slice(0, 3).join(" & ");
        const { data: titleMatches } = await supabase
          .from("artifacts")
          .select("id, title, cluster_id")
          .neq("id", artifact.id)
          .eq("is_test", false)
          .textSearch("title", searchTerms, { type: "websearch" });

        if (titleMatches && titleMatches.length > 0) {
          // Check if any match is already in a cluster
          const existingCluster = titleMatches.find(m => m.cluster_id);

          if (existingCluster?.cluster_id) {
            // Join existing cluster
            await supabase
              .from("artifacts")
              .update({ cluster_id: existingCluster.cluster_id })
              .eq("id", artifact.id);

            await supabase
              .from("artifact_clusters")
              .update({
                artifact_count: titleMatches.filter(m => m.cluster_id === existingCluster.cluster_id).length + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", existingCluster.cluster_id);

            clusteredCount++;
          } else {
            // Create new cluster
            const { data: newCluster, error: clusterError } = await supabase
              .from("artifact_clusters")
              .insert({
                representative_title: title,
                artifact_count: titleMatches.length + 1,
              })
              .select()
              .single();

            if (!clusterError && newCluster) {
              // Assign all matching artifacts to this cluster
              const allIds = [artifact.id, ...titleMatches.map(m => m.id)];
              await supabase
                .from("artifacts")
                .update({ cluster_id: newCluster.id })
                .in("id", allIds);

              newClusters++;
              clusteredCount += allIds.length;
            }
          }
        }
        continue;
      }

      // Process embedding-based matches
      if (similarArtifacts && similarArtifacts.length > 1) {
        const matchIds = similarArtifacts.map((m: Record<string, unknown>) => m.id).filter((id: unknown) => id !== artifact.id);

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

// Generate a simple 384-dimensional embedding from text using character-level hashing
// This is a fallback when proper embeddings aren't available
async function generateSimpleEmbedding(text: string): Promise<number[]> {
  const normalized = text.toLowerCase().trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Expand 32-byte hash to 384-dimensional vector by repeating and varying
  const embedding = new Float64Array(384);
  for (let i = 0; i < 384; i++) {
    const byteIdx = i % 32;
    const variation = Math.sin(i * 0.1) * 0.5;
    embedding[i] = (hashArray[byteIdx] / 255.0 - 0.5) + variation;
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return Array.from(embedding.map(v => v / magnitude));
}
