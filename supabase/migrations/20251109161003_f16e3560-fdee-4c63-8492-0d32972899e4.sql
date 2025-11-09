-- Add new constraint - all data should now be 'manual' which is valid
ALTER TABLE query_history ADD CONSTRAINT query_history_run_stages_check 
  CHECK (run_stages IN ('manual', 'automated'));