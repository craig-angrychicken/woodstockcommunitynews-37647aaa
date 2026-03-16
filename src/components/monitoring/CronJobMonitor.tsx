import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCronJobLogs, useCronJobStats } from "@/hooks/useCronJobLogs";
import { formatDistanceToNow } from "date-fns";
import { Clock, CheckCircle2, XCircle, AlertCircle, BarChart3 } from "lucide-react";

export const CronJobMonitor = () => {
  const { data: logs, isLoading } = useCronJobLogs(30);
  const { data: stats } = useCronJobStats();

  if (isLoading) {
    return <div className="text-muted-foreground">Loading cron job logs...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Runs (24h)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalRuns}</div>
              <p className="text-xs text-muted-foreground">
                {stats.successfulRuns} successful, {stats.failedRuns} failed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Artifacts Fetched</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalArtifacts}</div>
              <p className="text-xs text-muted-foreground">
                {stats.artifactFetchRuns} fetch runs
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Stories Created</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalStories}</div>
              <p className="text-xs text-muted-foreground">
                {stats.journalismRuns} journalism runs
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Last Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xs space-y-1">
                {stats.lastArtifactFetch && (
                  <div>Fetch: {formatDistanceToNow(new Date(stats.lastArtifactFetch), { addSuffix: true })}</div>
                )}
                {stats.lastJournalismRun && (
                  <div>Story: {formatDistanceToNow(new Date(stats.lastJournalismRun), { addSuffix: true })}</div>
                )}
                {stats.lastEditorRun && (
                  <div>Editor: {formatDistanceToNow(new Date(stats.lastEditorRun), { addSuffix: true })}</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Editor / Facebook</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.editorRuns}</div>
              <p className="text-xs text-muted-foreground">
                editor runs (24h)
              </p>
              <div className="text-xs space-y-1 mt-2">
                <div className="text-success">FB posted: {stats.facebookPosted}</div>
                {stats.facebookMissing > 0 && (
                  <div className="text-warning">FB missing: {stats.facebookMissing}</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detailed Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Recent Cron Job Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {logs?.map((log) => (
                <div
                  key={log.id}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        {log.schedule_check_passed && !log.error_message ? (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        ) : log.error_message ? (
                          <XCircle className="h-4 w-4 text-destructive" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-warning" />
                        )}
                        <span className="font-medium">
                          {log.job_name === "scheduled-fetch-artifacts" ? "Artifact Fetch"
                            : log.job_name === "run-editor" ? "AI Editor"
                            : "AI Journalism"}
                        </span>
                        <Badge variant={log.schedule_check_passed ? "default" : "outline"}>
                          {log.schedule_check_passed ? "Executed" : "Skipped"}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(log.triggered_at), { addSuffix: true })}
                        {log.time_checked && ` • Checked at ${log.time_checked} ET`}
                        {log.execution_duration_ms && ` • ${log.execution_duration_ms}ms`}
                      </div>

                      <div className="text-sm">
                        {log.reason && <div className="text-muted-foreground">{log.reason}</div>}
                        {log.error_message && (
                          <div className="text-destructive mt-1">Error: {log.error_message}</div>
                        )}
                      </div>

                      {(log.sources_count !== null || log.artifacts_count !== null || log.stories_count !== null) && (
                        <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                          {log.sources_count !== null && <span>Sources: {log.sources_count}</span>}
                          {log.artifacts_count !== null && <span>Artifacts: {log.artifacts_count}</span>}
                          {log.stories_count !== null && <span>Stories: {log.stories_count}</span>}
                        </div>
                      )}

                      {log.scheduled_times && log.scheduled_times.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Scheduled for: {log.scheduled_times.join(", ")} EST
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};
