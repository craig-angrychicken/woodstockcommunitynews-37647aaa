-- Fix the search_path for cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_cron_logs()
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.cron_job_logs
  WHERE triggered_at < now() - INTERVAL '30 days';
END;
$$;