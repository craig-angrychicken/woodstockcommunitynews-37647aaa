import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CronJobLog {
  id: string;
  job_name: string;
  triggered_at: string;
  schedule_check_passed: boolean;
  schedule_enabled: boolean | null;
  scheduled_times: string[] | null;
  time_checked: string | null;
  reason: string | null;
  query_history_id: string | null;
  sources_count: number | null;
  artifacts_count: number | null;
  stories_count: number | null;
  error_message: string | null;
  execution_duration_ms: number | null;
  created_at: string;
}

export const useCronJobLogs = (limit: number = 50) => {
  return useQuery({
    queryKey: ["cron-job-logs", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_job_logs")
        .select("*")
        .order("triggered_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as CronJobLog[];
    },
  });
};

export const useCronJobLogsByName = (jobName: string, limit: number = 20) => {
  return useQuery({
    queryKey: ["cron-job-logs", jobName, limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_job_logs")
        .select("*")
        .eq("job_name", jobName)
        .order("triggered_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as CronJobLog[];
    },
  });
};

export const useCronJobStats = () => {
  return useQuery({
    queryKey: ["cron-job-stats"],
    queryFn: async () => {
      // Get stats for last 24 hours
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);

      const { data, error } = await supabase
        .from("cron_job_logs")
        .select("*")
        .gte("triggered_at", oneDayAgo.toISOString());

      if (error) throw error;

      const logs = data as CronJobLog[];
      
      // Calculate stats
      const artifactFetchLogs = logs.filter(l => l.job_name === "scheduled-fetch-artifacts");
      const journalismLogs = logs.filter(l => l.job_name === "scheduled-run-journalism");
      
      return {
        totalRuns: logs.length,
        artifactFetchRuns: artifactFetchLogs.length,
        journalismRuns: journalismLogs.length,
        successfulRuns: logs.filter(l => l.schedule_check_passed && !l.error_message).length,
        failedRuns: logs.filter(l => l.error_message).length,
        skippedRuns: logs.filter(l => !l.schedule_check_passed && !l.error_message).length,
        totalArtifacts: artifactFetchLogs.reduce((sum, l) => sum + (l.artifacts_count || 0), 0),
        totalStories: journalismLogs.reduce((sum, l) => sum + (l.stories_count || 0), 0),
        lastArtifactFetch: artifactFetchLogs.find(l => l.schedule_check_passed)?.triggered_at,
        lastJournalismRun: journalismLogs.find(l => l.schedule_check_passed)?.triggered_at,
      };
    },
    refetchInterval: 60000, // Refresh every minute
  });
};
