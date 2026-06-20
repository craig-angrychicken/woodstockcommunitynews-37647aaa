import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";
import type { ArtifactRow, StoredImage } from "../../_shared/types";

/**
 * Admin CRUD for artifacts backing the SPA's artifact views.
 * Mounted at /api/admin; the parent admin router applies the Cloudflare Access gate.
 *
 * Fidelity notes (see src/hooks/useArtifacts.ts):
 *  - LEFT JOIN sources so orphaned artifacts (source_id = null) still return.
 *  - The SPA reads `source: { name, type }` and `story_artifacts: [{ story: { id, title } }]`,
 *    then derives usage from story_artifacts.length. We compute that join server-side and
 *    reshape rows into those nested objects so existing components keep working.
 *  - usageStatus ('all' | 'used' | 'unused') is enforced via a story_artifacts count
 *    (HAVING) so filtering happens in SQL instead of client-side.
 *  - searchQuery does a case-insensitive LIKE across title/content/name.
 *  - JSON TEXT columns (images, embedding) are decoded with fromJson on read.
 */
export const artifactsRouter = new Hono<{ Bindings: Env }>();

/** D1 row coming back from the artifacts LEFT JOIN sources (+ optional usage count). */
type ArtifactJoinRow = ArtifactRow & {
  // Aliased join columns (sources.* would collide with artifacts.name).
  source_name: string | null;
  source_type: string | null;
  story_count?: number;
};

/** Reshape a flat join row into the nested object shape the SPA hooks expect. */
function shapeArtifact(
  row: ArtifactJoinRow,
  stories: { id: string; title: string | null }[],
) {
  const { source_name, source_type, story_count, ...artifact } = row;
  return {
    ...artifact,
    images: fromJson<StoredImage[]>(artifact.images, []),
    embedding: fromJson<number[]>(artifact.embedding, []),
    source: source_name === null && source_type === null
      ? null
      : { name: source_name, type: source_type },
    story_artifacts: stories.map((s) => ({ story: { id: s.id, title: s.title } })),
  };
}

const SELECT_BASE = `
  SELECT artifacts.*,
         sources.name AS source_name,
         sources.type AS source_type
  FROM artifacts
  LEFT JOIN sources ON artifacts.source_id = sources.id
`;

// GET /api/admin/artifacts — list artifacts with optional filters.
// Filters: sourceId, dateFrom, dateTo, searchQuery, usageStatus ('all' | 'used' | 'unused').
artifactsRouter.get("/artifacts", async (c) => {
  const { sourceId, dateFrom, dateTo, searchQuery, usageStatus } = c.req.query();

  const where: string[] = [];
  const params: unknown[] = [];

  if (sourceId) {
    where.push("artifacts.source_id = ?");
    params.push(sourceId);
  }
  if (dateFrom) {
    where.push("artifacts.date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("artifacts.date <= ?");
    params.push(dateTo);
  }
  if (searchQuery) {
    // Case-insensitive LIKE across title/content/name (SQLite LIKE is case-insensitive for ASCII).
    const like = `%${searchQuery}%`;
    where.push("(artifacts.title LIKE ? OR artifacts.content LIKE ? OR artifacts.name LIKE ?)");
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // usageStatus is derived from the story_artifacts join count, applied via HAVING so the
  // filter runs in SQL rather than on the client (which previously checked story_artifacts.length).
  let having = "";
  if (usageStatus === "used") having = "HAVING story_count > 0";
  else if (usageStatus === "unused") having = "HAVING story_count = 0";

  const sql = `
    SELECT artifacts.*,
           sources.name AS source_name,
           sources.type AS source_type,
           COUNT(story_artifacts.id) AS story_count
    FROM artifacts
    LEFT JOIN sources ON artifacts.source_id = sources.id
    LEFT JOIN story_artifacts ON story_artifacts.artifact_id = artifacts.id
    ${whereSql}
    GROUP BY artifacts.id
    ${having}
    ORDER BY artifacts.date DESC
  `;

  const rows = await all<ArtifactJoinRow>(c.env, sql, ...params);

  // Pull the related story (id, title) per artifact so the SPA's story_artifacts[].story shape holds.
  const ids = rows.map((r) => r.id);
  const storiesByArtifact = new Map<string, { id: string; title: string | null }[]>();
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const links = await all<{ artifact_id: string; id: string; title: string | null }>(
      c.env,
      `SELECT story_artifacts.artifact_id, stories.id, stories.title
         FROM story_artifacts
         LEFT JOIN stories ON story_artifacts.story_id = stories.id
        WHERE story_artifacts.artifact_id IN (${placeholders})`,
      ...ids,
    );
    for (const link of links) {
      const list = storiesByArtifact.get(link.artifact_id) ?? [];
      list.push({ id: link.id, title: link.title });
      storiesByArtifact.set(link.artifact_id, list);
    }
  }

  const artifacts = rows.map((r) => shapeArtifact(r, storiesByArtifact.get(r.id) ?? []));
  return c.json({ artifacts });
});

// GET /api/admin/artifacts/:id — single artifact with source join and related stories.
artifactsRouter.get("/artifacts/:id", async (c) => {
  const id = c.req.param("id");

  const row = await first<ArtifactJoinRow>(c.env, `${SELECT_BASE} WHERE artifacts.id = ?`, id);
  if (!row) return c.json({ error: "not found" }, 404);

  const links = await all<{ id: string; title: string | null }>(
    c.env,
    `SELECT stories.id, stories.title
       FROM story_artifacts
       LEFT JOIN stories ON story_artifacts.story_id = stories.id
      WHERE story_artifacts.artifact_id = ?`,
    id,
  );

  return c.json({ artifact: shapeArtifact(row, links) });
});

// DELETE /api/admin/artifacts/:id — remove an artifact.
artifactsRouter.delete("/artifacts/:id", async (c) => {
  const id = c.req.param("id");
  await run(c.env, `DELETE FROM artifacts WHERE id = ?`, id);
  return c.json({ success: true });
});
