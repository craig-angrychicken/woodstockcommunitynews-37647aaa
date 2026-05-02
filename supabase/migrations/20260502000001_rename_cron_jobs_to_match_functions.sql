-- Rename pg_cron jobs so jobnames match the edge function names they invoke.
-- Lets monitoring queries (cron.job, cron.job_run_details) be keyed off the
-- same identifier used in cron_job_logs.

-- run-editor → scheduled-run-editor
DO $$
DECLARE
  existing_schedule TEXT;
BEGIN
  SELECT schedule INTO existing_schedule FROM cron.job WHERE jobname = 'run-editor';
  IF existing_schedule IS NOT NULL THEN
    PERFORM cron.unschedule('run-editor');
    PERFORM cron.schedule(
      'scheduled-run-editor',
      existing_schedule,
      $CMD$
      SELECT net.http_post(
        url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-run-editor',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
      $CMD$
    );
  END IF;
END $$;

-- recover-stuck-queue-items → scheduled-recover-queue
DO $$
DECLARE
  existing_schedule TEXT;
BEGIN
  SELECT schedule INTO existing_schedule FROM cron.job WHERE jobname = 'recover-stuck-queue-items';
  IF existing_schedule IS NOT NULL THEN
    PERFORM cron.unschedule('recover-stuck-queue-items');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-recover-queue') THEN
    PERFORM cron.schedule(
      'scheduled-recover-queue',
      COALESCE(existing_schedule, '*/15 * * * *'),
      $CMD$
      SELECT net.http_post(
        url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-recover-queue',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
      $CMD$
    );
  END IF;
END $$;
