-- Add missing progress-tracking columns to query_history
-- These columns are referenced by ManualQuery.tsx (progress bar),
-- fetch-rss-feeds (per-source updates), and scheduled-fetch-artifacts (insert).
ALTER TABLE query_history
  ADD COLUMN IF NOT EXISTS sources_total integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sources_processed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sources_failed integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_source_id uuid,
  ADD COLUMN IF NOT EXISTS current_source_name text;
