-- Enable extensions required for cron scheduling and HTTP calls from Postgres
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Set AI model to claude-sonnet-4-6 via OpenRouter
INSERT INTO public.app_settings (key, value)
VALUES (
  'ai_model_config',
  '{"model_name": "claude-sonnet-4-6", "model_provider": "openrouter"}'::jsonb
)
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = now();

-- Configure artifact fetch schedule: 06:00, 12:00, 18:00 EST
INSERT INTO public.schedules (schedule_type, scheduled_times, is_enabled)
VALUES (
  'artifact_fetch',
  '["06:00", "12:00", "18:00"]'::jsonb,
  true
)
ON CONFLICT (schedule_type) DO UPDATE
  SET scheduled_times = EXCLUDED.scheduled_times,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = now();

-- Configure AI journalism schedule: 07:00, 13:00, 19:00 EST (1 hour after fetch)
INSERT INTO public.schedules (schedule_type, scheduled_times, is_enabled)
VALUES (
  'ai_journalism',
  '["07:00", "13:00", "19:00"]'::jsonb,
  true
)
ON CONFLICT (schedule_type) DO UPDATE
  SET scheduled_times = EXCLUDED.scheduled_times,
      is_enabled = EXCLUDED.is_enabled,
      updated_at = now();

-- Create cron job: fetch RSS artifacts every 30 minutes
SELECT cron.schedule(
  'fetch-artifacts',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-fetch-artifacts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Create cron job: run AI journalism pipeline every hour
SELECT cron.schedule(
  'run-journalism',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-run-journalism',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
