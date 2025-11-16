import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";

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

interface QueueProcessorProps {
  historyId: string | null;
  isRunning: boolean;
  onDismiss?: () => void;
}

export const QueueProcessor = ({ historyId, isRunning, onDismiss }: QueueProcessorProps) => {
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!historyId) {
      setQueueItems([]);
      return;
    }

    setLoading(true);

    // Initial fetch
    const fetchQueue = async () => {
      const { data, error } = await supabase
        .from("journalism_queue")
        .select(`
          *,
          artifact:artifacts(title, name)
        `)
        .eq("query_history_id", historyId)
        .order("position", { ascending: true });

      if (error) {
        console.error("Error fetching queue:", error);
        setLoading(false);
        return;
      }

      setQueueItems((data as any) || []);
      setLoading(false);
    };

    fetchQueue();

    // Subscribe to realtime updates
    const channel = supabase
      .channel(`journalism_queue_${historyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "journalism_queue",
          filter: `query_history_id=eq.${historyId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setQueueItems((prev) => [...prev, payload.new as QueueItem].sort((a, b) => a.position - b.position));
          } else if (payload.eventType === "UPDATE") {
            setQueueItems((prev) =>
              prev.map((item) => (item.id === payload.new.id ? (payload.new as QueueItem) : item))
            );
          } else if (payload.eventType === "DELETE") {
            setQueueItems((prev) => prev.filter((item) => item.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [historyId]);

  if (!historyId || queueItems.length === 0) {
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
          <Badge variant="outline" className="ml-2">
            {completed + failed} / {total}
          </Badge>
          {isRunning && onDismiss && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDismiss}
              className="ml-2"
            >
              Stop Monitoring
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
};
