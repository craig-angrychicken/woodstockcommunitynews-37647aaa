-- Reschedule pipeline for 90-minute story delivery
-- Replace 3x/day specific-time gating with frequent staggered runs during active hours (6 AM - 10 PM ET)

-- A. Add active-hours columns to schedules table
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS active_hour_start INTEGER DEFAULT 6;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS active_hour_end INTEGER DEFAULT 22;

UPDATE schedules SET active_hour_start = 6, active_hour_end = 22
WHERE schedule_type IN ('artifact_fetch', 'ai_journalism', 'ai_editor');

-- B. Update pg_cron frequencies
-- fetch-artifacts: every 15 minutes (was every 30)
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'fetch-artifacts'),
  schedule := '*/15 * * * *'
);

-- cluster-artifacts: 4x per hour at :05, :20, :35, :50 (was :50 only)
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'cluster-artifacts'),
  schedule := '5,20,35,50 * * * *'
);

-- run-journalism: 4x per hour at :10, :25, :40, :55 (was hourly at :00)
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'run-journalism'),
  schedule := '10,25,40,55 * * * *'
);

-- run-editor: 3x per hour at :14, :34, :54 (was hourly at :00)
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'run-editor'),
  schedule := '14,34,54 * * * *'
);
