/**
 * Artifact clustering.
 *
 * Notes:
 *  - Similarity is computed in-worker as cosine over the `embedding` TEXT column
 *    (decoded from JSON), using a 0.82 threshold and join-existing-vs-create-new
 *    logic.
 *  - Embeddings are generated via the shared `generateEmbedding` helper and
 *    persisted to the `embedding` TEXT column so later runs can reuse them.
 *  - Returns a plain summary object; routing/cron wiring lives elsewhere.
 */
import type { Env } from "../env";
import type { ArtifactRow } from "../_shared/types";
import { all, insert, run, fromJson, toJson } from "../_shared/db";
import { generateEmbedding } from "../_shared/llm-client";
import { checkScheduleGate } from "../_shared/schedule-gate";
import { logCronJob } from "../_shared/cron-logger";

const SIMILARITY_THRESHOLD = 0.82;

export interface ClusterArtifactsSummary {
  success: boolean;
  message?: string;
  totalArtifacts?: number;
  embeddingsGenerated?: number;
  newClusters?: number;
  clustered?: number;
  error?: string;
}

/** Cosine similarity between two equal-length numeric vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function clusterArtifacts(
  env: Env,
  opts: { force?: boolean; startTime?: number } = {},
): Promise<ClusterArtifactsSummary> {
  console.log("🔗 Starting artifact clustering...");

  const startTime = opts.startTime ?? Date.now();

  try {
    // Active-hours gate (piggybacks on the artifact_fetch schedule's is_enabled + active hours)
    const gate = await checkScheduleGate(env, "artifact_fetch", "cluster-artifacts", {
      force: opts.force,
      startTime,
    });
    if (!gate.passed) {
      return { success: false, message: gate.reason };
    }

    // Fetch unclustered, non-test artifacts (no cluster_id).
    const artifacts = await all<
      Pick<ArtifactRow, "id" | "title" | "name" | "date" | "source_id">
    >(
      env,
      `select id, title, name, date, source_id
         from artifacts
        where cluster_id is null
          and is_test = 0
        order by date desc
        limit 200`,
    );

    if (artifacts.length === 0) {
      console.log("✅ No unclustered artifacts found");
      return { success: true, clustered: 0, newClusters: 0 };
    }

    console.log(`📦 Found ${artifacts.length} unclustered artifacts`);

    // Generate embeddings for each artifact title via OpenRouter.
    const embeddingsMap = new Map<string, number[]>();

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      try {
        const embedding = await generateEmbedding(title, env.OPENROUTER_API_KEY);
        embeddingsMap.set(artifact.id, embedding);
      } catch (err) {
        console.warn(`⚠️ Embedding generation failed for artifact ${artifact.id}:`, err);
      }
    }

    console.log(`📊 Generated ${embeddingsMap.size} embeddings`);

    // Persist embeddings to the database (TEXT JSON column).
    for (const [artifactId, embedding] of embeddingsMap) {
      try {
        await run(
          env,
          `update artifacts set embedding = ? where id = ?`,
          toJson(embedding),
          artifactId,
        );
      } catch (err) {
        console.warn(`⚠️ Failed to store embedding for ${artifactId}:`, err);
      }
    }

    // Cluster artifacts by cosine similarity computed in-worker.
    let newClusters = 0;
    let clusteredCount = 0;

    // Fetch the candidate set ONCE and decode embeddings into memory up front, so the
    // per-artifact loop computes cosine against a cached set instead of re-querying D1
    // and re-decoding JSON on every iteration. `cluster_id` is tracked mutably and kept
    // in sync with the writes below so the join-existing-cluster logic still sees updates
    // made by earlier iterations.
    const candidateRows = await all<{
      id: string;
      embedding: string | null;
      cluster_id: string | null;
    }>(
      env,
      `select id, embedding, cluster_id
         from artifacts
        where embedding is not null
          and is_test = 0`,
    );

    const candidates: Array<{ id: string; embedding: number[]; cluster_id: string | null }> = [];
    for (const row of candidateRows) {
      const candEmbedding = fromJson<number[] | null>(row.embedding, null);
      if (!candEmbedding) continue;
      candidates.push({ id: row.id, embedding: candEmbedding, cluster_id: row.cluster_id });
    }

    // Index by id so we can reflect cluster assignments back into the cached set.
    const candidateById = new Map(candidates.map((c) => [c.id, c]));

    for (const artifact of artifacts) {
      const title = artifact.title || artifact.name || "";
      if (!title.trim()) continue;

      const embedding = embeddingsMap.get(artifact.id);
      if (!embedding) continue;

      // Skip if already clustered by a previous iteration in this loop.
      if (candidateById.get(artifact.id)?.cluster_id) continue;

      // Find similar artifacts by cosine similarity over the cached candidate set.
      const matches: Array<{ id: string; cluster_id: string | null; similarity: number }> = [];
      for (const candidate of candidates) {
        const similarity = cosineSimilarity(embedding, candidate.embedding);
        if (similarity >= SIMILARITY_THRESHOLD) {
          matches.push({ id: candidate.id, cluster_id: candidate.cluster_id, similarity });
        }
      }

      // Mirror the RPC's match_count: 10 (ordered by similarity desc, self included).
      matches.sort((a, b) => b.similarity - a.similarity);
      const topMatches = matches.slice(0, 10);

      // Need at least one other artifact besides self to form/join a cluster.
      if (topMatches.length <= 1) continue;

      const others = topMatches.filter((m) => m.id !== artifact.id);
      if (others.length === 0) continue;

      // If any matched artifact already belongs to a cluster, join it.
      const existingClustered = others.find((m) => m.cluster_id);
      if (existingClustered?.cluster_id) {
        await run(
          env,
          `update artifacts set cluster_id = ? where id = ?`,
          existingClustered.cluster_id,
          artifact.id,
        );
        // Reflect the assignment back into the cached set for later iterations.
        const cached = candidateById.get(artifact.id);
        if (cached) cached.cluster_id = existingClustered.cluster_id;
        clusteredCount++;
      } else {
        // Create a new cluster spanning self + matches.
        const matchIds = others.map((m) => m.id);
        const now = new Date().toISOString();
        const newCluster = await insert<{ id: string }>(env, "artifact_clusters", {
          id: crypto.randomUUID(),
          representative_title: title,
          artifact_count: matchIds.length + 1,
          created_at: now,
          updated_at: now,
        });

        if (newCluster) {
          const allIds = [artifact.id, ...matchIds];
          const placeholders = allIds.map(() => "?").join(", ");
          await run(
            env,
            `update artifacts set cluster_id = ? where id in (${placeholders})`,
            newCluster.id,
            ...allIds,
          );

          // Reflect the assignments back into the cached set for later iterations.
          for (const id of allIds) {
            const cached = candidateById.get(id);
            if (cached) cached.cluster_id = newCluster.id;
          }

          newClusters++;
          clusteredCount += allIds.length;
        }
      }
    }

    const summary: ClusterArtifactsSummary = {
      success: true,
      totalArtifacts: artifacts.length,
      embeddingsGenerated: embeddingsMap.size,
      newClusters,
      clustered: clusteredCount,
    };

    console.log("✅ Clustering complete:", summary);

    await logCronJob(env, {
      job_name: "cluster-artifacts",
      schedule_check_passed: true,
      schedule_enabled: true,
      reason: `Clustered ${clusteredCount} artifacts into ${newClusters} new clusters (${embeddingsMap.size} embeddings generated from ${artifacts.length} unclustered)`,
      execution_duration_ms: Date.now() - startTime,
    });

    return summary;
  } catch (error) {
    console.error("💥 Fatal error in cluster-artifacts:", error);

    await logCronJob(env, {
      job_name: "cluster-artifacts",
      schedule_check_passed: true,
      reason: "Fatal error during clustering",
      error_message: error instanceof Error ? error.message : "Unknown error",
      execution_duration_ms: Date.now() - startTime,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
