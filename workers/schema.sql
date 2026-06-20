-- WCN D1 (SQLite) schema.
-- Conventions: ids are TEXT(uuid), timestamps are TEXT(ISO), booleans are
--   INTEGER(0/1), decimals are REAL, and JSON / array / embedding columns are TEXT(JSON).
-- Admin auth is handled by Cloudflare Access (no row-level auth in the DB).
-- Embeddings live in TEXT columns; similarity is computed in-worker (no vector indexes).
-- FKs are enforced at the application layer (avoids D1 circular-FK + import-order issues).
-- updated_at / content_updated_at are maintained in app code (db helpers), not triggers.

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  type TEXT NOT NULL CHECK (type IN ('RSS Feed', 'Web Page')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'testing', 'paused', 'error')),
  last_fetch_at TEXT,
  items_fetched INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  parser_config TEXT
);

CREATE TABLE IF NOT EXISTS artifact_clusters (
  id TEXT PRIMARY KEY,
  representative_title TEXT,
  artifact_count INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size_mb REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  title TEXT,
  content TEXT,
  guid TEXT UNIQUE,
  source_id TEXT,
  date TEXT DEFAULT (datetime('now')),
  is_test INTEGER NOT NULL DEFAULT 0,
  images TEXT DEFAULT '[]',
  hero_image_url TEXT,
  url TEXT,
  embedding TEXT,            -- JSON array of 384 floats (in-worker cosine)
  cluster_id TEXT
);

CREATE TABLE IF NOT EXISTS council_meetings (
  id TEXT PRIMARY KEY,
  granicus_clip_id INTEGER,
  meeting_type TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  agenda_url TEXT,
  agenda_detected_at TEXT,
  packet_url TEXT,
  packet_detected_at TEXT,
  minutes_url TEXT,
  minutes_detected_at TEXT,
  agenda_content TEXT,
  packet_content TEXT,
  minutes_content TEXT,
  preview_story_id TEXT,
  update_story_id TEXT,
  recap_story_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  granicus_event_id INTEGER,
  CHECK (granicus_clip_id IS NOT NULL OR granicus_event_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS cron_job_logs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
  schedule_check_passed INTEGER NOT NULL,
  schedule_enabled INTEGER,
  scheduled_times TEXT,
  time_checked TEXT,
  reason TEXT,
  query_history_id TEXT,
  sources_count INTEGER,
  artifacts_count INTEGER,
  stories_count INTEGER,
  error_message TEXT,
  execution_duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS journalism_queue (
  id TEXT PRIMARY KEY,
  query_history_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  story_id TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  UNIQUE (query_history_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  version_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  prompt_type TEXT NOT NULL DEFAULT 'journalism'
    CHECK (prompt_type IN ('retrieval', 'journalism', 'editor')),
  is_test_draft INTEGER NOT NULL DEFAULT 0,
  update_notes TEXT,
  based_on_version_id TEXT,
  test_status TEXT DEFAULT 'not_tested'
    CHECK (test_status IN ('not_tested', 'tested', 'ready_to_activate')),
  test_results TEXT,
  author TEXT DEFAULT 'System'
);

CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  prompt_version_id TEXT,
  source_ids TEXT NOT NULL,   -- JSON array of uuids
  run_stages TEXT NOT NULL CHECK (run_stages IN ('manual', 'automated')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  artifacts_count INTEGER DEFAULT 0,
  stories_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  skipped_count INTEGER DEFAULT 0,
  sources_total INTEGER DEFAULT 0,
  sources_processed INTEGER DEFAULT 0,
  sources_failed INTEGER DEFAULT 0,
  current_source_id TEXT,
  current_source_name TEXT
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  schedule_type TEXT NOT NULL UNIQUE
    CHECK (schedule_type IN ('artifact_fetch', 'ai_journalism', 'ai_editor', 'council_scraper')),
  scheduled_times TEXT NOT NULL DEFAULT '[]',
  is_enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  active_hour_start INTEGER DEFAULT 6,
  active_hour_end INTEGER DEFAULT 22
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fact_checked', 'edited', 'draft', 'published', 'archived', 'rejected')),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_test INTEGER DEFAULT 0,
  environment TEXT DEFAULT 'production' CHECK (environment IN ('production', 'test')),
  article_type TEXT DEFAULT 'full' CHECK (article_type IN ('brief', 'full')),
  prompt_version_id TEXT,
  guid TEXT,
  source_id TEXT,
  published_url TEXT,
  hero_image_url TEXT,
  editor_notes TEXT,
  featured INTEGER NOT NULL DEFAULT 0,
  structured_metadata TEXT,
  fact_check_notes TEXT,
  word_count INTEGER,
  source_count INTEGER DEFAULT 1,
  reading_level TEXT,
  generation_metadata TEXT,
  facebook_post_id TEXT,
  facebook_post_url TEXT,
  facebook_posted_at TEXT,
  publish_attempts INTEGER DEFAULT 0,
  title_embedding TEXT,       -- JSON array of 384 floats
  slug TEXT,
  facebook_photo_post_at TEXT,
  content_updated_at TEXT,
  council_meeting_id TEXT,
  story_type TEXT
);

CREATE TABLE IF NOT EXISTS story_artifacts (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (story_id, artifact_id)
);

-- Indexes (non-vector). Partial + DESC indexes are supported by SQLite/D1.
CREATE UNIQUE INDEX IF NOT EXISTS council_meetings_clip_id_key ON council_meetings (granicus_clip_id) WHERE granicus_clip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS council_meetings_event_id_key ON council_meetings (granicus_event_id) WHERE granicus_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_artifacts_cluster_id ON artifacts (cluster_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_created_at ON artifacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_is_test ON artifacts (is_test);
CREATE INDEX IF NOT EXISTS idx_council_meetings_date ON council_meetings (meeting_date DESC);
CREATE INDEX IF NOT EXISTS idx_cron_job_logs_job_name ON cron_job_logs (job_name);
CREATE INDEX IF NOT EXISTS idx_cron_job_logs_triggered_at ON cron_job_logs (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_journalism_queue_status_position ON journalism_queue (query_history_id, status, position);
CREATE INDEX IF NOT EXISTS idx_journalism_queue_stuck ON journalism_queue (status, started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_prompt_versions_test_draft ON prompt_versions (is_test_draft);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_type_active ON prompt_versions (prompt_type, is_active);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status);
CREATE INDEX IF NOT EXISTS idx_stories_hero_image_url ON stories (hero_image_url) WHERE hero_image_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stories_is_test ON stories (is_test);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_slug ON stories (slug) WHERE slug IS NOT NULL;
