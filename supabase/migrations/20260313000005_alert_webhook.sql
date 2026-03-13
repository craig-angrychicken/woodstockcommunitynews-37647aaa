-- Create a function that sends alerts when cron_job_logs has errors
-- Uses pg_net to call the send-alert edge function

CREATE OR REPLACE FUNCTION notify_on_cron_error()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when there's an error message
  IF NEW.error_message IS NOT NULL AND NEW.error_message != '' THEN
    PERFORM net.http_post(
      url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/send-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body := jsonb_build_object(
        'functionName', NEW.job_name,
        'errorMessage', NEW.error_message,
        'timestamp', NEW.created_at::text,
        'context', jsonb_build_object(
          'execution_duration_ms', NEW.execution_duration_ms,
          'schedule_check_passed', NEW.schedule_check_passed
        )
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on cron_job_logs
DROP TRIGGER IF EXISTS cron_error_alert ON cron_job_logs;
CREATE TRIGGER cron_error_alert
  AFTER INSERT ON cron_job_logs
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_cron_error();
