import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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

export interface CronJobStats {
  totalRuns: number;
  artifactFetchRuns: number;
  journalismRuns: number;
  editorRuns: number;
  successfulRuns: number;
  failedRuns: number;
  skippedRuns: number;
  totalArtifacts: number;
  totalStories: number;
  lastArtifactFetch?: string;
  lastJournalismRun?: string;
  lastEditorRun?: string;
  facebookPosted: number;
  facebookMissing: number;
}

export const useCronJobLogs = (limit: number = 50) => {
  return useQuery({
    queryKey: ["cron-job-logs", limit],
    queryFn: () => api.get<CronJobLog[]>("/cron-job-logs", { limit }),
  });
};

export const useCronJobLogsByName = (jobName: string, limit: number = 20) => {
  return useQuery({
    queryKey: ["cron-job-logs", jobName, limit],
    queryFn: () =>
      api.get<CronJobLog[]>(`/cron-job-logs/${jobName}`, { limit }),
  });
};

export const useCronJobStats = () => {
  return useQuery({
    queryKey: ["cron-job-stats"],
    // Stats (last 24h aggregations + Facebook coverage) are computed server-side.
    queryFn: () => api.get<CronJobStats>("/cron-job-logs/stats"),
    refetchInterval: 60000, // Refresh every minute
  });
};
