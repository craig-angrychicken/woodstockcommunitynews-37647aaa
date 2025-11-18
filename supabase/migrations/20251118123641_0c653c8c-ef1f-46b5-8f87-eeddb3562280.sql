-- Create cron_job_logs table to track all scheduled job attempts
CREATE TABLE IF NOT EXISTS public.cron_job_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_name TEXT NOT NULL,
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  schedule_check_passed BOOLEAN NOT NULL,
  schedule_enabled BOOLEAN,
  scheduled_times JSONB,
  time_checked TEXT,
  reason TEXT,
  query_history_id UUID,
  sources_count INTEGER,
  artifacts_count INTEGER,
  stories_count INTEGER,
  error_message TEXT,
  execution_duration_ms INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient querying
CREATE INDEX idx_cron_job_logs_triggered_at ON public.cron_job_logs(triggered_at DESC);
CREATE INDEX idx_cron_job_logs_job_name ON public.cron_job_logs(job_name);

-- Enable RLS
ALTER TABLE public.cron_job_logs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to view logs
CREATE POLICY "Allow authenticated users to view cron job logs"
ON public.cron_job_logs
FOR SELECT
TO authenticated
USING (true);

-- Create function to clean up old logs (keep last 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_cron_logs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.cron_job_logs
  WHERE triggered_at < now() - INTERVAL '30 days';
END;
$$;