-- Schedule cluster-artifacts to run at :50 every hour, 10 minutes before
-- the journalism pipeline fires at :00. This ensures all newly-fetched
-- artifacts are clustered (and deduped) before the journalism queue is built.
SELECT cron.schedule(
  'cluster-artifacts',
  '50 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/cluster-artifacts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
