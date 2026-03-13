-- Schedule queue recovery watchdog to run every 15 minutes
SELECT cron.schedule(
  'recover-stuck-queue-items',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-recover-queue',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
