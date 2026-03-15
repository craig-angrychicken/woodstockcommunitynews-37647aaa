-- Stories: filtered by status + environment + is_test, ordered by created_at
-- Used by: run-ai-fact-checker, run-ai-rewriter, run-ai-editor, agent.mjs
CREATE INDEX IF NOT EXISTS idx_stories_status_env_created
  ON stories(status, environment, is_test, created_at);

-- Artifacts: filtered/ordered by created_at for recency queries
-- Used by: agent.mjs (24h/8h artifact volume), cluster-artifacts
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at
  ON artifacts(created_at DESC);

-- Sources: filtered by status for health monitoring
-- Used by: agent.mjs, fetch-rss-feeds, Sources page
CREATE INDEX IF NOT EXISTS idx_sources_status
  ON sources(status);

-- Journalism queue: finding stuck items (status + started_at)
-- Used by: recover-stuck-queue-items
CREATE INDEX IF NOT EXISTS idx_journalism_queue_stuck
  ON journalism_queue(status, started_at)
  WHERE status = 'processing';
