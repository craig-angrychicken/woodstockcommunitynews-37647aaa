-- Add skipped_count to query_history to track artifacts skipped due to insufficient source material
ALTER TABLE query_history ADD COLUMN IF NOT EXISTS skipped_count integer DEFAULT 0;
