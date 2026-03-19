import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Ban, XCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  useSkippedArtifacts,
  useRejectedStories,
  useSkipRejectCounts,
} from "@/hooks/useSkipsRejections";

export const SkipsRejectionsPanel = () => {
  const { data: counts, isLoading: countsLoading } = useSkipRejectCounts();
  const { data: skipped, isLoading: skippedLoading } = useSkippedArtifacts(7);
  const { data: rejected, isLoading: rejectedLoading } = useRejectedStories(7);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Ban className="h-4 w-4" />
              Skipped (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {countsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{counts?.skippedCount ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Rejected (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {countsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{counts?.rejectedCount ?? 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="skipped">
        <TabsList>
          <TabsTrigger value="skipped">
            Skipped Artifacts
            {skipped && skipped.length > 0 && (
              <Badge variant="secondary" className="ml-2">{skipped.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="rejected">
            Rejected Stories
            {rejected && rejected.length > 0 && (
              <Badge variant="destructive" className="ml-2">{rejected.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skipped">
          <Card>
            <CardContent className="pt-6">
              {skippedLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : skipped && skipped.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {skipped.map((item, idx) => (
                      <div key={idx} className="border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                        <div className="flex items-start gap-2">
                          <Ban className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {item.title || "Untitled artifact"}
                            </p>
                            {item.skip_reason && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {item.skip_reason}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDistanceToNow(new Date(item.completed_at), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">No skipped artifacts in the last 7 days</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rejected">
          <Card>
            <CardContent className="pt-6">
              {rejectedLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                </div>
              ) : rejected && rejected.length > 0 ? (
                <ScrollArea className="h-[400px]">
                  <div className="space-y-3">
                    {rejected.map((item, idx) => (
                      <div key={idx} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                        <p className="text-sm font-medium">{item.title}</p>
                        {item.rejection_reason && (
                          <p className="text-sm text-destructive/80 mt-1">
                            {item.rejection_reason}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(item.updated_at), { addSuffix: true })}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">No rejected stories in the last 7 days</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
