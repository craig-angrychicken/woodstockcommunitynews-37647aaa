import { Hono } from "hono";
import type { Env } from "../env";
import { verifyAccess } from "../_shared/auth";
import { first, insert, toJson } from "../_shared/db";
import type { PromptVersionRow } from "../_shared/types";
import { fetchArtifacts } from "../pipeline/fetch-artifacts";
import { fetchRssFeeds } from "../pipeline/fetch-rss";
import { fetchWebPages } from "../pipeline/fetch-web-pages";
import { clusterArtifacts } from "../pipeline/cluster-artifacts";
import { recoverStuckQueueItems } from "../pipeline/queue-recovery";
import { runFactChecker, runRewriter, runEditor, runEditorialPipeline } from "../pipeline/editorial-pipeline";
import { regenerateStories } from "../pipeline/story-regeneration";
import { scrapeMeetings, generateCouncilStory } from "../pipeline/council";
import { createJournalismQueue } from "../pipeline/journalism-queue";
import { backfillArtifactImages } from "../pipeline/backfill-artifact-images";
import { backfillStoryImages } from "../pipeline/backfill-story-images";
import { publishStory } from "../pipeline/publish-story";
import { bulkRepostFacebook } from "../pipeline/bulk-repost-facebook";
import { publishAboutPage } from "../pipeline/publish-about-page";
import { triggerRevalidate } from "../pipeline/trigger-revalidate";
import { manageSchedule } from "../pipeline/manage-schedule";
import { fetchOpenRouterModels } from "../pipeline/fetch-openrouter-models";
import { testReadability } from "../pipeline/test-readability";
import { kickJournalismQueue } from "../queue";

/**
 * Admin pipeline triggers (replaces the SPA's supabase.functions.invoke(...) calls).
 * Cloudflare Access gates the host; verifyAccess is defense-in-depth.
 * Mounted at /api/admin alongside the CRUD router.
 */
export const pipelineAdmin = new Hono<{ Bindings: Env }>();

pipelineAdmin.use("*", async (c, next) => {
  if (!(await verifyAccess(c.req.raw, c.env))) return c.json({ error: "unauthorized" }, 401);
  await next();
});

const body = async (c: { req: { json: () => Promise<unknown> } }) =>
  ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

pipelineAdmin.post("/pipeline/fetch-artifacts", async (c) => c.json(await fetchArtifacts(c.env, { force: true })));

// Manual single-source-type fetch (ManualQuery). Creates a query_history run if none supplied.
async function manualFetch(
  c: { env: Env; req: { json: () => Promise<unknown> } },
  fn: (env: Env, p: { dateFrom: string; dateTo: string; sourceIds: string[]; environment: "production" | "test"; queryHistoryId: string }) => Promise<unknown>,
) {
  const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const now = new Date();
  const dateTo = b.dateTo ? String(b.dateTo) : now.toISOString();
  const dateFrom = b.dateFrom ? String(b.dateFrom) : new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const environment: "production" | "test" = (b.environment as string) === "test" ? "test" : "production";
  const sourceIds = Array.isArray(b.sourceIds) ? (b.sourceIds as string[]) : [];
  let queryHistoryId = b.queryHistoryId ? String(b.queryHistoryId) : "";
  if (!queryHistoryId) {
    queryHistoryId = crypto.randomUUID();
    await insert(c.env, "query_history", {
      id: queryHistoryId, date_from: dateFrom, date_to: dateTo, environment,
      source_ids: toJson(sourceIds), run_stages: "manual", status: "running",
    });
  }
  const result = await fn(c.env, { dateFrom, dateTo, sourceIds, environment, queryHistoryId });
  return { queryHistoryId, result };
}

pipelineAdmin.post("/pipeline/fetch-rss", async (c) => c.json(await manualFetch(c, fetchRssFeeds)));
pipelineAdmin.post("/pipeline/fetch-web-pages", async (c) => c.json(await manualFetch(c, fetchWebPages)));
pipelineAdmin.post("/pipeline/cluster", async (c) => c.json(await clusterArtifacts(c.env, { force: true, startTime: Date.now() })));
pipelineAdmin.post("/pipeline/recover-queue", async (c) => c.json(await recoverStuckQueueItems(c.env, {})));
pipelineAdmin.post("/pipeline/fact-checker", async (c) => c.json(await runFactChecker(c.env)));
pipelineAdmin.post("/pipeline/rewriter", async (c) => c.json(await runRewriter(c.env)));
pipelineAdmin.post("/pipeline/editor", async (c) => c.json(await runEditor(c.env)));
pipelineAdmin.post("/pipeline/editorial", async (c) => c.json(await runEditorialPipeline(c.env)));
pipelineAdmin.post("/pipeline/scrape-council", async (c) => c.json(await scrapeMeetings(c.env)));

pipelineAdmin.post("/pipeline/regenerate", async (c) => {
  const b = await body(c);
  return c.json(await regenerateStories(c.env, { maxStories: Number(b.maxStories) || undefined }));
});

pipelineAdmin.post("/pipeline/generate-council-story", async (c) => {
  const b = await body(c);
  return c.json(await generateCouncilStory(c.env, String(b.meetingId), b.storyType as "preview" | "update" | "recap"));
});

pipelineAdmin.post("/pipeline/backfill-artifact-images", async (c) => {
  const b = await body(c);
  return c.json(await backfillArtifactImages(c.env, b.sourceId ? String(b.sourceId) : undefined));
});
pipelineAdmin.post("/pipeline/backfill-story-images", async (c) => {
  const b = await body(c);
  return c.json(await backfillStoryImages(c.env, b.mode as "broken" | "missing" | undefined));
});

// Manual journalism run: create a query_history then build + kick the queue.
pipelineAdmin.post("/pipeline/journalism", async (c) => {
  const b = await body(c);
  const now = new Date();
  const dateTo = b.dateTo ? String(b.dateTo) : now.toISOString();
  const dateFrom = b.dateFrom ? String(b.dateFrom) : new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const environment = (b.environment as string) === "test" ? "test" : "production";
  const prompt = await first<Pick<PromptVersionRow, "id">>(
    c.env,
    `select id from prompt_versions where prompt_type='journalism' and is_active=1 limit 1`,
  );
  const historyId = crypto.randomUUID();
  await insert(c.env, "query_history", {
    id: historyId, date_from: dateFrom, date_to: dateTo, environment,
    prompt_version_id: (b.promptVersionId as string) ?? prompt?.id ?? null,
    source_ids: toJson(b.sourceIds ?? []), run_stages: "manual", status: "running",
  });
  const artifactIds = Array.isArray(b.artifactIds) ? (b.artifactIds as string[]) : undefined;
  const res = await createJournalismQueue(c.env, historyId, dateFrom, dateTo, artifactIds);
  await kickJournalismQueue(c.env, res.firstItemId);
  return c.json({ ...res, historyId });
});

pipelineAdmin.post("/stories/:id/publish", async (c) => {
  const b = await body(c);
  return c.json(await publishStory(c.env, c.req.param("id"), Boolean(b.featured)));
});
pipelineAdmin.post("/stories/bulk-repost-facebook", async (c) => c.json(await bulkRepostFacebook(c.env, await body(c))));
pipelineAdmin.post("/pages/about", async (c) => c.json(await publishAboutPage(c.env)));
pipelineAdmin.post("/revalidate", async (c) => {
  const b = await body(c);
  return c.json(await triggerRevalidate(c.env, (b.paths as string[]) ?? []));
});

pipelineAdmin.post("/manage-schedule", async (c) => {
  const b = await body(c);
  return c.json(await manageSchedule(c.env, {
    scheduleType: b.scheduleType as "artifact_fetch" | "ai_journalism" | "ai_editor",
    scheduledTimes: (b.scheduledTimes as string[]) ?? [],
    isEnabled: Boolean(b.isEnabled),
  }));
});
pipelineAdmin.get("/openrouter-models", async (c) => c.json(await fetchOpenRouterModels(c.env.OPENROUTER_API_KEY)));
pipelineAdmin.post("/test-readability", async (c) => {
  const b = await body(c);
  return c.json(await testReadability(c.env, { url: String(b.url), link_selector: b.link_selector as string | undefined }));
});
