-- Drop the old constraint first
ALTER TABLE query_history DROP CONSTRAINT IF EXISTS query_history_run_stages_check;