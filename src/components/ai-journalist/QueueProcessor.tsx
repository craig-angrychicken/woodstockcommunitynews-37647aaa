import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface QueueItem {
  id: string;
  artifact_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  position: number;
  error_message?: string;
  artifact?: {
    title?: string;
    name: string;
  };
}

interface HistoryDetails {
  created_at: string;
  completed_at: string | null;
  status: string;
}

interface QueueProcessorProps {
  historyId: string | null;
  isRunning: boolean;
  onDismiss?: () => void;
}

export const QueueProcessor = ({ historyId, isRunning, onDismiss }: QueueProcessorProps) => {
  // History details for the run header (started/completed timestamps).
  const { data: historyDetails = null } = useQuery({
    queryKey: ["query-history", historyId],
    queryFn: () => api.get<HistoryDetails>(`/query-history/${historyId}`),
    enabled: !!historyId,
  });

  // Queue items, joined to their artifact. Replaces the Supabase realtime
  // subscription with React Query polling (1000ms while mounted with a run).
  const { data: queueItems = [] } = useQuery({
    queryKey: ["journalism-queue", historyId],
    queryFn: () =>
      api.get<QueueItem[]>("/journalism-queue", { historyId: historyId as string }),
    enabled: !!historyId,
    refetchInterval: 1000,
  });

  if (!historyId) {
    return null;
  }

  const completed = queueItems.filter((i) => i.status === "completed").length;
  const failed = queueItems.filter((i) => i.status === "failed").length;
  const processing = queueItems.find((i) => i.status === "processing");
  const pending = queueItems.filter((i) => i.status === "pending").length;
  const total = queueItems.length;
  const progress = total > 0 ? ((completed + failed) / total) * 100 : 0;
  const isComplete = pending === 0 && !processing;

  const statusConfig = isRunning
    ? { icon: Loader2, text: "Running", variant: "default" as const, iconClass: "animate-spin text-primary" }
    : isComplete && failed === 0
    ? { icon: CheckCircle, text: "Completed", variant: "secondary" as const, iconClass: "text-green-500" }
    : failed > 0
    ? { icon: XCircle, text: "Completed with errors", variant: "destructive" as const, iconClass: "text-destructive" }
    : { icon: Clock, text: "Pending", variant: "outline" as const, iconClass: "text-muted-foreground" };

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-background to-muted/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <statusConfig.icon className={cn("h-5 w-5", statusConfig.iconClass)} />
          Queue Processor
          <Badge variant={statusConfig.variant} className="ml-auto">
            {statusConfig.text}
          </Badge>
          {total > 0 && (
            <Badge variant="outline" className="ml-2">
              {completed + failed} / {total}
            </Badge>
          )}
          {onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="ml-2"
            >
              {isRunning ? "Stop Monitoring" : "Dismiss"}
            </Button>
          )}
        </CardTitle>
        {historyDetails && (
          <CardDescription className="text-xs">
            Started: {format(new Date(historyDetails.created_at), "PPp")}
            {historyDetails.completed_at && ` • Completed: ${format(new Date(historyDetails.completed_at), "PPp")}`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No items were queued for this run
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

        {processing && (
          <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <Loader2 className="h-4 w-4 animate-spin text-primary mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Processing</p>
              <p className="text-sm text-muted-foreground truncate">
                {processing.artifact?.title || processing.artifact?.name || "Untitled artifact"}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{queueItems.filter((i) => i.status === "pending").length}</span>
            </div>
            <p className="text-xs text-muted-foreground">Pending</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold text-green-500">{completed}</span>
            </div>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-center gap-1">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-2xl font-bold text-destructive">{failed}</span>
            </div>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </div>

            {failed > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">Failed Items:</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {queueItems
                    .filter((i) => i.status === "failed")
                    .map((item) => (
                      <div key={item.id} className="text-xs text-muted-foreground pl-2 border-l-2 border-destructive/30">
                        {item.artifact?.title || item.artifact?.name || "Untitled"}
                        {item.error_message && <span className="block text-destructive/80">{item.error_message}</span>}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
