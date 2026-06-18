import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";

/**
 * Admin monitoring API — cron job logs, skip/reject diagnostics, and the
 * story_artifacts junction. Mounted under /api/admin (parent applies the
 * Cloudflare Access gate — do NOT re-gate here).
 *
 * Shapes mirror the SPA hooks (src/hooks/useCronJobLogs.ts,
 * src/hooks/useSkipsRejections.ts): booleans are decoded from 0/1, the
 * scheduled_times JSON TEXT column is decoded to string[], and the stats /
 * counts aggregations are computed server-side in SQL.
 */
export const monitoringRouter = new Hono<{ Bindings: Env }>();

// Imported per the shared-router contract; this surface is read-only so the
// write helpers go unused — reference them to satisfy noUnusedLocals.
void run;
void insert;
void toJson;

interface CronJobLogShape {
  id: string;
  job_name: string;
  triggered_at: string;
  schedule_check_passed: boolean;
  schedule_enabled: boolean | null;
  scheduled_times: string[] | null;
  time_checked: string | null;
  reason: string | null;
  query_history_id: string | null;
  sources_count: number | null;
  artifacts_count: number | null;
  stories_count: number | null;
  error_message: string | null;
  execution_duration_ms: number | null;
  created_at: string;
}

/** Raw cron_job_logs row as stored in D1 (booleans 0/1, scheduled_times JSON TEXT). */
interface CronJobLogRow {
  id: string;
  job_name: string;
  triggered_at: string;
  schedule_check_passed: number;
  schedule_enabled: number | null;
  scheduled_times: string | null;
  time_checked: string | null;
  reason: string | null;
  query_history_id: string | null;
  sources_count: number | null;
  artifacts_count: number | null;
  stories_count: number | null;
  error_message: string | null;
  execution_duration_ms: number | null;
  created_at: string;
}

/** Decode a raw cron_job_logs row into the shape the SPA expects. */
function decodeCronLog(row: CronJobLogRow): CronJobLogShape {
  return {
    id: row.id,
    job_name: row.job_name,
    triggered_at: row.triggered_at,
    schedule_check_passed: row.schedule_check_passed === 1,
    schedule_enabled: row.schedule_enabled == null ? null : row.schedule_enabled === 1,
    scheduled_times: fromJson<string[] | null>(row.scheduled_times, null),
    time_checked: row.time_checked,
    reason: row.reason,
    query_history_id: row.query_history_id,
    sources_count: row.sources_count,
    artifacts_count: row.artifacts_count,
    stories_count: row.stories_count,
    error_message: row.error_message,
    execution_duration_ms: row.execution_duration_ms,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// /cron-job-logs — list, stats, by-name. More-specific routes register first.
// ---------------------------------------------------------------------------

// GET /api/admin/cron-job-logs/stats — last-24h aggregations (useCronJobStats).
// Computed server-side with conditional COUNT/SUM rather than in the client.
monitoringRouter.get("/cron-job-logs/stats", async (c) => {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const stats = await first<{
    totalRuns: number;
    artifactFetchRuns: number;
    journalismRuns: number;
    editorRuns: number;
    successfulRuns: number;
    failedRuns: number;
    skippedRuns: number;
    totalArtifacts: number;
    totalStories: number;
  }>(
    c.env,
    `SELECT
       COUNT(*) AS totalRuns,
       SUM(CASE WHEN job_name = 'scheduled-fetch-artifacts' THEN 1 ELSE 0 END) AS artifactFetchRuns,
       SUM(CASE WHEN job_name = 'scheduled-run-journalism' THEN 1 ELSE 0 END) AS journalismRuns,
       SUM(CASE WHEN job_name IN ('scheduled-run-editor', 'run-editor') THEN 1 ELSE 0 END) AS editorRuns,
       SUM(CASE WHEN schedule_check_passed = 1 AND error_message IS NULL THEN 1 ELSE 0 END) AS successfulRuns,
       SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) AS failedRuns,
       SUM(CASE WHEN schedule_check_passed = 0 AND error_message IS NULL THEN 1 ELSE 0 END) AS skippedRuns,
       SUM(CASE WHEN job_name = 'scheduled-fetch-artifacts' THEN COALESCE(artifacts_count, 0) ELSE 0 END) AS totalArtifacts,
       SUM(CASE WHEN job_name = 'scheduled-run-journalism' THEN COALESCE(stories_count, 0) ELSE 0 END) AS totalStories
     FROM cron_job_logs
     WHERE triggered_at >= ?`,
    cutoff,
  );

  // Most-recent successful run timestamp per job type (within the window).
  const lastArtifactFetch = await first<{ triggered_at: string }>(
    c.env,
    `SELECT triggered_at FROM cron_job_logs
       WHERE job_name = 'scheduled-fetch-artifacts' AND schedule_check_passed = 1 AND triggered_at >= ?
       ORDER BY triggered_at DESC LIMIT 1`,
    cutoff,
  );
  const lastJournalismRun = await first<{ triggered_at: string }>(
    c.env,
    `SELECT triggered_at FROM cron_job_logs
       WHERE job_name = 'scheduled-run-journalism' AND schedule_check_passed = 1 AND triggered_at >= ?
       ORDER BY triggered_at DESC LIMIT 1`,
    cutoff,
  );
  const lastEditorRun = await first<{ triggered_at: string }>(
    c.env,
    `SELECT triggered_at FROM cron_job_logs
       WHERE job_name IN ('scheduled-run-editor', 'run-editor') AND schedule_check_passed = 1 AND triggered_at >= ?
       ORDER BY triggered_at DESC LIMIT 1`,
    cutoff,
  );

  // Facebook coverage: published stories with / without a Facebook post.
  const fbPosted = await first<{ n: number }>(
    c.env,
    `SELECT COUNT(*) AS n FROM stories WHERE status = 'published' AND facebook_posted_at IS NOT NULL`,
  );
  const fbMissing = await first<{ n: number }>(
    c.env,
    `SELECT COUNT(*) AS n FROM stories WHERE status = 'published' AND facebook_posted_at IS NULL`,
  );

  return c.json({
    totalRuns: stats?.totalRuns ?? 0,
    artifactFetchRuns: stats?.artifactFetchRuns ?? 0,
    journalismRuns: stats?.journalismRuns ?? 0,
    editorRuns: stats?.editorRuns ?? 0,
    successfulRuns: stats?.successfulRuns ?? 0,
    failedRuns: stats?.failedRuns ?? 0,
    skippedRuns: stats?.skippedRuns ?? 0,
    totalArtifacts: stats?.totalArtifacts ?? 0,
    totalStories: stats?.totalStories ?? 0,
    lastArtifactFetch: lastArtifactFetch?.triggered_at,
    lastJournalismRun: lastJournalismRun?.triggered_at,
    lastEditorRun: lastEditorRun?.triggered_at,
    facebookPosted: fbPosted?.n ?? 0,
    facebookMissing: fbMissing?.n ?? 0,
  });
});

// GET /api/admin/cron-job-logs/:jobName — logs for one job (useCronJobLogsByName).
monitoringRouter.get("/cron-job-logs/:jobName", async (c) => {
  const jobName = c.req.param("jobName");
  const limit = Number(c.req.query("limit")) || 20;
  const rows = await all<CronJobLogRow>(
    c.env,
    `SELECT * FROM cron_job_logs WHERE job_name = ? ORDER BY triggered_at DESC LIMIT ?`,
    jobName,
    limit,
  );
  return c.json(rows.map(decodeCronLog));
});

// GET /api/admin/cron-job-logs — recent logs (useCronJobLogs).
monitoringRouter.get("/cron-job-logs", async (c) => {
  const limit = Number(c.req.query("limit")) || 50;
  const rows = await all<CronJobLogRow>(
    c.env,
    `SELECT * FROM cron_job_logs ORDER BY triggered_at DESC LIMIT ?`,
    limit,
  );
  return c.json(rows.map(decodeCronLog));
});

// ---------------------------------------------------------------------------
// Skip / reject diagnostics (useSkipsRejections).
// ---------------------------------------------------------------------------

// GET /api/admin/skipped-artifacts — skipped journalism-queue items + artifact.
// Maps error_message -> skip_reason and joins artifact title/url, last N days.
monitoringRouter.get("/skipped-artifacts", async (c) => {
  const days = Number(c.req.query("days")) || 7;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await all<{
    title: string | null;
    skip_reason: string | null;
    url: string | null;
    completed_at: string;
  }>(
    c.env,
    `SELECT artifacts.title AS title,
            journalism_queue.error_message AS skip_reason,
            artifacts.url AS url,
            journalism_queue.completed_at AS completed_at
       FROM journalism_queue
       LEFT JOIN artifacts ON journalism_queue.artifact_id = artifacts.id
      WHERE journalism_queue.status = 'skipped'
        AND journalism_queue.completed_at >= ?
      ORDER BY journalism_queue.completed_at DESC`,
    cutoff,
  );
  return c.json(rows);
});

// GET /api/admin/rejected-stories — editor-rejected production stories, last N days.
// Maps editor_notes -> rejection_reason. is_test stored as 0/1.
monitoringRouter.get("/rejected-stories", async (c) => {
  const days = Number(c.req.query("days")) || 7;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const rows = await all<{
    title: string;
    rejection_reason: string | null;
    updated_at: string;
  }>(
    c.env,
    `SELECT title,
            editor_notes AS rejection_reason,
            updated_at
       FROM stories
      WHERE status = 'rejected'
        AND is_test = 0
        AND environment = 'production'
        AND updated_at >= ?
      ORDER BY updated_at DESC`,
    cutoff,
  );
  return c.json(rows);
});

// GET /api/admin/skip-reject-counts — last-24h skipped/rejected counts (useSkipRejectCounts).
// Two independent COUNTs (the SPA runs them as parallel head:exact queries).
monitoringRouter.get("/skip-reject-counts", async (c) => {
  const cutoff = new Date(Date.now() - 86400000).toISOString();

  const skipped = await first<{ n: number }>(
    c.env,
    `SELECT COUNT(*) AS n FROM journalism_queue
      WHERE status = 'skipped' AND completed_at >= ?`,
    cutoff,
  );
  const rejected = await first<{ n: number }>(
    c.env,
    `SELECT COUNT(*) AS n FROM stories
      WHERE status = 'rejected' AND is_test = 0 AND environment = 'production' AND updated_at >= ?`,
    cutoff,
  );

  return c.json({
    skippedCount: skipped?.n ?? 0,
    rejectedCount: rejected?.n ?? 0,
  });
});

// ---------------------------------------------------------------------------
// story_artifacts junction. More-specific /count before the parametric route.
// ---------------------------------------------------------------------------

// GET /api/admin/story-artifacts/count — full junction map (artifact_id, story_id).
// Used by AIJournalist.tsx to compute available/used artifacts client-side.
monitoringRouter.get("/story-artifacts/count", async (c) => {
  const rows = await all<{ artifact_id: string; story_id: string }>(
    c.env,
    `SELECT artifact_id, story_id FROM story_artifacts`,
  );
  return c.json(rows);
});

// GET /api/admin/story-artifacts/:artifactId — stories linked to one artifact.
// (Artifacts.tsx artifactStories query.) LEFT JOIN to surface story id/title.
monitoringRouter.get("/story-artifacts/:artifactId", async (c) => {
  const artifactId = c.req.param("artifactId");
  const rows = await all(
    c.env,
    `SELECT story_artifacts.*, stories.id AS story_id, stories.title AS title
       FROM story_artifacts
       LEFT JOIN stories ON story_artifacts.story_id = stories.id
      WHERE story_artifacts.artifact_id = ?`,
    artifactId,
  );
  return c.json(rows);
});
