-- P0: Fix journalism pipeline broken by missing 'skipped' status

-- 1. Add 'skipped' to journalism_queue status constraint
ALTER TABLE journalism_queue DROP CONSTRAINT IF EXISTS journalism_queue_status_check;
ALTER TABLE journalism_queue ADD CONSTRAINT journalism_queue_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped'));

-- 2. Mark all stuck 'processing' queue items as 'failed'
UPDATE journalism_queue
SET status = 'failed',
    completed_at = NOW(),
    error_message = 'Marked failed during pipeline stabilization cleanup (was stuck in processing)'
WHERE status = 'processing';

-- 3. Mark orphaned 'running' query_history records as 'failed'
UPDATE query_history
SET status = 'failed',
    completed_at = NOW(),
    error_message = 'Marked failed during pipeline stabilization cleanup (queue items were stuck)'
WHERE status = 'running';

-- 4. Fix the broken pg_cron command for recover-stuck-queue-items
-- (previous command used string concat that produces NULL headers when service_role_key setting is absent)
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'recover-stuck-queue-items'),
  command := $CMD$
    SELECT net.http_post(
      url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-recover-queue',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $CMD$
);
