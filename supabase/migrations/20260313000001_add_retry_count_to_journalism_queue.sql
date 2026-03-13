-- Add retry_count column to journalism_queue for watchdog recovery
ALTER TABLE journalism_queue
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
