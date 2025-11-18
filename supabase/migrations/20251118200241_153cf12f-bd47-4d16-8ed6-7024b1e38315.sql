-- Drop the existing policy that allows all authenticated users
DROP POLICY IF EXISTS "Allow authenticated users to view cron job logs" ON public.cron_job_logs;

-- Create admin-only policy for viewing cron job logs
CREATE POLICY "Only admins can view cron job logs"
ON public.cron_job_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));