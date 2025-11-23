import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Loader2, Play, CheckCircle, XCircle, X, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { formatUTCtoEST } from "@/lib/time-utils";
import { TestBadge } from "@/components/ui/status-badge";
import { Progress } from "@/components/ui/progress";
import { PreviewRenderedPageModal } from "@/components/sources/PreviewRenderedPageModal";
import { ScheduleTimeSelector } from "@/components/scheduling/ScheduleTimeSelector";
import { SaveScheduleButton } from "@/components/scheduling/SaveScheduleButton";
import { useSchedule } from "@/hooks/useSchedules";

const ManualQuery = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [dateFrom, setDateFrom] = useState<Date>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<"production" | "test">("test");
  const [promptMode, setPromptMode] = useState<"active" | "select">("active");
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<string>("");
  
  const [isRunning, setIsRunning] = useState(false);
  const [activeQuickDate, setActiveQuickDate] = useState<number | null>(7);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewSource, setPreviewSource] = useState<{ url: string; selector: string } | null>(null);
  
  // Scheduling state
  const [fetchScheduleTimes, setFetchScheduleTimes] = useState<string[]>([]);
  const [fetchScheduleEnabled, setFetchScheduleEnabled] = useState(false);
  
  // Load existing schedule
  const { data: existingSchedule } = useSchedule("artifact_fetch");
  
  useEffect(() => {
    if (existingSchedule) {
      setFetchScheduleTimes(existingSchedule.scheduled_times || []);
      setFetchScheduleEnabled(existingSchedule.is_enabled);
    }
  }, [existingSchedule]);

  // Fetch sources
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .in('status', ['active', 'testing'])
        .order('name');
      if (error) throw error;
      return data;
    }
  });

  // Fetch prompt versions
  const { data: promptVersions } = useQuery({
    queryKey: ['prompt-versions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prompt_versions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  // Fetch query history
  const { data: queryHistory } = useQuery({
    queryKey: ['query-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('query_history')
        .select(`
          *,
          prompt_versions (version_name)
        `)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as any[]; // Cast to any until types are regenerated
    }
  });

  const activePromptVersion = useMemo(
    () => promptVersions?.find(p => p.is_active),
    [promptVersions]
  );

  const costEstimate = useMemo(() => {
    const days = Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24));
    const sourcesCount = selectedSources.length;
    const estimatedArticles = days * sourcesCount * 2; // Rough estimate
    const costPerArticle = 0.02; // Rough cost estimate
    return (estimatedArticles * costPerArticle).toFixed(2);
  }, [dateFrom, dateTo, selectedSources]);

  // Track current running history ID
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);

  // Poll for progress updates when query is running
  const { data: currentProgress } = useQuery({
    queryKey: ['query-progress', currentHistoryId],
    queryFn: async () => {
      if (!currentHistoryId) return null;
      
      const { data, error } = await supabase
        .from('query_history')
        .select('*')
        .eq('id', currentHistoryId)
        .single();
      
      if (error) throw error;
      
      // Stop running state if query completed or failed
      if (data.status !== 'running') {
        setIsRunning(false);
        setCurrentHistoryId(null);
      }
      
      return data as any; // Cast to any until types are regenerated
    },
    enabled: !!currentHistoryId && isRunning,
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Get the display query (current running or most recent from history)
  const displayQuery = currentProgress || (queryHistory && queryHistory.length > 0 ? queryHistory[0] : null);

  // Detect stale queries (running for > 5 minutes)
  const isStaleQuery = displayQuery?.status === 'running' && 
    displayQuery?.created_at &&
    new Date().getTime() - new Date(displayQuery.created_at).getTime() > 5 * 60 * 1000;

  // Cancel query mutation
  const cancelQueryMutation = useMutation({
    mutationFn: async (historyId: string) => {
      const { error } = await supabase
        .from('query_history')
        .update({
          status: 'failed',
          error_message: 'Cancelled by user',
          completed_at: new Date().toISOString()
        })
        .eq('id', historyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
      toast({
        title: "Query Cancelled",
        description: "The query has been stopped.",
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Cancel",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Run query mutation
  const runQueryMutation = useMutation({
    mutationFn: async () => {
      if (selectedSources.length === 0) {
        throw new Error('Please select at least one source');
      }

      const promptVersionId = promptMode === 'active' 
        ? activePromptVersion?.id 
        : selectedPromptVersion;

      if (!promptVersionId) {
        throw new Error('No prompt version selected');
      }

      // Create history record
      const { data: historyRecord, error: historyError } = await supabase
        .from('query_history')
        .insert({
          date_from: dateFrom.toISOString(),
          date_to: dateTo.toISOString(),
          environment,
          prompt_version_id: promptVersionId,
          source_ids: selectedSources,
          run_stages: 'manual',
          status: 'running'
        })
        .select()
        .single();

      if (historyError) throw historyError;

      // Store the history ID for potential cancellation
      setCurrentHistoryId(historyRecord.id);

      // Determine which sources are RSS feeds vs web scraping
      const allSources = sources || [];
      const selectedSourceData = allSources.filter(s => selectedSources.includes(s.id));
      const rssSources = selectedSourceData.filter(s => s.type === 'RSS Feed').map(s => s.id);
      const scrapeSources = selectedSourceData.filter(s => s.type !== 'RSS Feed').map(s => s.id);

      let totalArtifacts = 0;

      // Fetch RSS feeds first (if any)
      if (rssSources.length > 0) {
        console.log('📡 Fetching RSS feeds:', rssSources.length);
        const { data: rssData, error: rssError } = await supabase.functions.invoke('fetch-rss-feeds', {
          body: {
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString(),
            sourceIds: rssSources,
            environment,
            queryHistoryId: historyRecord.id
          }
        });

        if (rssError) {
          console.error('RSS fetch error:', rssError);
        } else {
          totalArtifacts += rssData?.artifactsCreated || 0;
          console.log('✅ RSS feeds fetched:', rssData?.artifactsCreated || 0, 'artifacts');
        }
      }

      // Scrape web sources (if any)
      let scrapeData = null;
      if (scrapeSources.length > 0) {
        console.log('🕷️ Scraping web sources:', scrapeSources.length);
        const { data, error } = await supabase.functions.invoke('scrape-articles', {
          body: {
            dateFrom: dateFrom.toISOString(),
            dateTo: dateTo.toISOString(),
            sourceIds: scrapeSources,
            environment,
            promptVersionId,
            runStages: 'manual',
            queryHistoryId: historyRecord.id
          }
        });

        if (error) throw error;
        scrapeData = data;
        totalArtifacts += data?.artifactsCreated || 0;
      }

      const { data, error } = { data: { ...scrapeData, totalArtifacts }, error: null };

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['query-history'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      
      toast({
        title: "Query Complete!",
        description: data.message,
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Query Failed",
        description: error.message,
        variant: "destructive"
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    }
  });

  const handleRunQuery = () => {
    setIsRunning(true);
    runQueryMutation.mutate();
  };

  const handleCancelQuery = () => {
    if (currentHistoryId) {
      cancelQueryMutation.mutate(currentHistoryId);
    }
  };

  const handleQuickDate = (days: number) => {
    const newDateFrom = new Date();
    newDateFrom.setDate(newDateFrom.getDate() - days);
    setDateFrom(newDateFrom);
    setDateTo(new Date());
    setActiveQuickDate(days);
  };

  const handleSelectAllSources = () => {
    setSelectedSources(sources?.map(s => s.id) || []);
  };

  const handleSelectNoneSources = () => {
    setSelectedSources([]);
  };

  const handleSelectTestSources = () => {
    const testSources = sources?.filter(s => s.status === 'testing').map(s => s.id) || [];
    setSelectedSources(testSources);
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSources(prev =>
      prev.includes(sourceId)
        ? prev.filter(id => id !== sourceId)
        : [...prev, sourceId]
    );
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Fetch Artifacts</h1>
        <p className="text-muted-foreground">
          Fetch and store articles from your sources as artifacts
        </p>
      </div>

      <Tabs defaultValue="run" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
          <TabsTrigger value="run">Run Fetch</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
        </TabsList>

        <TabsContent value="run">
          {/* Progress Display - Shows when fetch is running */}
          {displayQuery && (
            <Card className={cn(
              "mb-6",
              displayQuery.status === 'running' && "border-primary",
              displayQuery.status === 'completed' && "border-green-500",
              displayQuery.status === 'failed' && "border-destructive"
            )}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {displayQuery.status === 'running' && <Loader2 className="h-5 w-5 animate-spin" />}
                  {displayQuery.status === 'completed' && <CheckCircle className="h-5 w-5 text-green-500" />}
                  {displayQuery.status === 'failed' && <XCircle className="h-5 w-5 text-destructive" />}
                  {displayQuery.status === 'running' ? 'Processing Query' : displayQuery.status === 'completed' ? 'Last Query Completed' : 'Last Query Failed'}
                </CardTitle>
                <CardDescription>
                  {displayQuery.status === 'running' && displayQuery.current_source_name 
                    ? `Currently processing: ${displayQuery.current_source_name}`
                    : displayQuery.status === 'completed'
                    ? `Completed on ${formatUTCtoEST(displayQuery.completed_at || displayQuery.created_at, 'MMM d, yyyy h:mm a')}`
                    : displayQuery.error_message || 'Query failed'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {isStaleQuery && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Query may be stuck</AlertTitle>
                    <AlertDescription>
                      This query has been running for over 5 minutes. It may have encountered an error.
                    </AlertDescription>
                  </Alert>
                )}
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Sources Progress</span>
                    <span className="text-muted-foreground">
                      {displayQuery.sources_processed || 0} / {displayQuery.sources_total || 0}
                    </span>
                  </div>
                  <Progress 
                    value={displayQuery.sources_total 
                      ? ((displayQuery.sources_processed || 0) / displayQuery.sources_total) * 100 
                      : 0
                    } 
                  />
                </div>
                
                {displayQuery.sources_failed > 0 && (
                  <div className="text-sm text-yellow-600 dark:text-yellow-500">
                    ⚠️ {displayQuery.sources_failed} source(s) failed to process
                  </div>
                )}
                
                    <div className="text-sm">
                      <div className="text-muted-foreground">Artifacts Found</div>
                      <div className="text-2xl font-bold">{displayQuery.artifacts_count || 0}</div>
                    </div>
                
                {displayQuery.status === 'running' && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setIsRunning(false);
                      setCurrentHistoryId(null);
                      toast({
                        title: "Stopped Monitoring",
                        description: "Query will continue running in the background",
                      });
                    }}
                  >
                    Stop Monitoring
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              {/* Date Range Section */}
              <Card>
            <CardHeader>
              <CardTitle>Date Range</CardTitle>
              <CardDescription>Select the date range for source fetching</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>From Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dateFrom && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateFrom ? format(dateFrom, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateFrom}
                        onSelect={(date) => {
                          if (date) {
                            setDateFrom(date);
                            setActiveQuickDate(null);
                          }
                        }}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>To Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dateTo && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateTo ? format(dateTo, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dateTo}
                        onSelect={(date) => {
                          if (date) {
                            setDateTo(date);
                            setActiveQuickDate(null);
                          }
                        }}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  variant={activeQuickDate === 7 ? "default" : "outline"}
                  size="sm" 
                  onClick={() => handleQuickDate(7)}
                  className={cn(activeQuickDate === 7 && "bg-blue-600 hover:bg-blue-700")}
                >
                  Last 7 days
                </Button>
                <Button 
                  variant={activeQuickDate === 30 ? "default" : "outline"}
                  size="sm" 
                  onClick={() => handleQuickDate(30)}
                  className={cn(activeQuickDate === 30 && "bg-blue-600 hover:bg-blue-700")}
                >
                  Last 30 days
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Source Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Source Selection</CardTitle>
              <CardDescription>
                Choose which sources to fetch from ({selectedSources.length} selected)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={handleSelectAllSources}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={handleSelectNoneSources}>
                  Select None
                </Button>
                <Button variant="outline" size="sm" onClick={handleSelectTestSources}>
                  Select Test
                </Button>
                {selectedSources.length === 1 && sources && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const source = sources.find(s => s.id === selectedSources[0]);
                      if (source) {
                        const config = source.parser_config as any;
                        setPreviewSource({
                          url: source.url,
                          selector: config?.scrapeConfig?.containerSelector || '',
                        });
                        setPreviewModalOpen(true);
                      }
                    }}
                  >
                    Preview Rendered Page
                  </Button>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                {sources?.map(source => (
                  <div key={source.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={source.id}
                      checked={selectedSources.includes(source.id)}
                      onCheckedChange={() => toggleSource(source.id)}
                    />
                    <label
                      htmlFor={source.id}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                    >
                      <span>
                        {source.name}
                        <span className="text-muted-foreground text-xs ml-2">({source.type})</span>
                      </span>
                      {source.status === 'testing' && <TestBadge />}
                    </label>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Environment Section */}
          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Choose production or test mode</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={environment} onValueChange={(v: any) => setEnvironment(v)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="production" id="prod" />
                  <Label htmlFor="prod" className="cursor-pointer">
                    Production
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="test" id="test" />
                  <Label htmlFor="test" className="cursor-pointer">
                    Test
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-sm text-muted-foreground">
                Test mode adds a 🧪 badge and allows testing without affecting production data
              </p>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={handleRunQuery}
              disabled={isRunning || selectedSources.length === 0}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Running Query...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-5 w-5" />
                  Fetch Artifacts
                </>
              )}
            </Button>
            
            {isRunning && (
              <Button
                size="lg"
                variant="destructive"
                onClick={handleCancelQuery}
                disabled={cancelQueryMutation.isPending}
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
            </div>

            {/* Query History Sidebar */}
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Query History</CardTitle>
                  <CardDescription>Recent query runs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {queryHistory?.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No query history yet
                      </p>
                    ) : (
                      queryHistory?.map(query => (
                        <div
                          key={query.id}
                          className="border rounded-lg p-3 space-y-2 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <span className="text-sm font-medium">
                              {formatUTCtoEST(query.created_at)}
                            </span>
                            {query.status === 'completed' && (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                            {query.status === 'failed' && (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            {query.status === 'running' && (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelQueryMutation.mutate(query.id);
                                  }}
                                  disabled={cancelQueryMutation.isPending}
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="text-xs space-y-1 text-muted-foreground">
                            <div>Environment: {query.environment}</div>
                            <div>Prompt: {query.prompt_versions?.version_name}</div>
                            {query.status === 'running' && query.sources_total > 0 && (
                              <div className="text-primary font-medium">
                                Progress: {query.sources_processed}/{query.sources_total} sources
                              </div>
                            )}
                            <div>Results: {query.artifacts_count || 0} artifacts</div>
                            {query.sources_failed > 0 && (
                              <div className="text-yellow-600">⚠️ {query.sources_failed} failed</div>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Artifact Fetching Schedule</CardTitle>
              <CardDescription>
                Automatically fetch new artifacts from all active sources at scheduled times
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="fetch-schedule-enabled">Enable Scheduled Fetching</Label>
                <Switch
                  id="fetch-schedule-enabled"
                  checked={fetchScheduleEnabled}
                  onCheckedChange={setFetchScheduleEnabled}
                />
              </div>
              
              <ScheduleTimeSelector
                scheduledTimes={fetchScheduleTimes}
                onChange={setFetchScheduleTimes}
                label="Fetch Times"
                description="Choose specific times each day to fetch new artifacts"
                presets={[
                  { label: "6 AM", time: "06:00" },
                  { label: "12 PM", time: "12:00" },
                  { label: "6 PM", time: "18:00" },
                ]}
              />

              <SaveScheduleButton
                scheduleType="artifact_fetch"
                times={fetchScheduleTimes}
                enabled={fetchScheduleEnabled}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {previewSource && (
        <PreviewRenderedPageModal
          open={previewModalOpen}
          onOpenChange={setPreviewModalOpen}
          url={previewSource.url}
          containerSelector={previewSource.selector}
        />
      )}
    </div>
  );
};

export default ManualQuery;
