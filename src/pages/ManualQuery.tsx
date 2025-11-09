import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Loader2, Play, CheckCircle, XCircle, X, Info } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { TestBadge } from "@/components/ui/status-badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  
  const [maxArticles, setMaxArticles] = useState<number | null>(20);
  const [isRunning, setIsRunning] = useState(false);
  const [activeQuickDate, setActiveQuickDate] = useState<number | null>(7);

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

      // Call edge function
      const { data, error } = await supabase.functions.invoke('run-manual-query', {
        body: {
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
          sourceIds: selectedSources,
          environment,
          promptVersionId,
          runStages: 'manual',
          historyId: historyRecord.id,
          maxArticles
        }
      });

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

      {/* Resource Limits Alert */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Resource Limits</AlertTitle>
        <AlertDescription>
          To prevent timeouts, queries are limited to <strong>5 date enrichments</strong> and <strong>10 articles per source</strong>. 
          This ensures reliable processing while keeping response times reasonable.
        </AlertDescription>
      </Alert>

      {/* Progress Display */}
      {isRunning && currentProgress && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing Query
            </CardTitle>
            <CardDescription>
              {currentProgress.current_source_name 
                ? `Currently processing: ${currentProgress.current_source_name}`
                : 'Initializing...'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Sources Progress</span>
                <span className="text-muted-foreground">
                  {currentProgress.sources_processed || 0} / {currentProgress.sources_total || selectedSources.length}
                </span>
              </div>
              <Progress 
                value={currentProgress.sources_total 
                  ? ((currentProgress.sources_processed || 0) / currentProgress.sources_total) * 100 
                  : 0
                } 
              />
            </div>
            
            {currentProgress.sources_failed > 0 && (
              <div className="text-sm text-yellow-600 dark:text-yellow-500">
                ⚠️ {currentProgress.sources_failed} source(s) failed to process
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Artifacts Found</div>
                <div className="text-2xl font-bold">{currentProgress.artifacts_count || 0}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Stories Created</div>
                <div className="text-2xl font-bold">{currentProgress.stories_count || 0}</div>
              </div>
            </div>
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
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleSelectAllSources}>
                  Select All
                </Button>
                <Button variant="outline" size="sm" onClick={handleSelectNoneSources}>
                  Select None
                </Button>
                <Button variant="outline" size="sm" onClick={handleSelectTestSources}>
                  Select Test
                </Button>
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

          {/* Run Options */}
          <Card>
            <CardHeader>
              <CardTitle>Run Options</CardTitle>
              <CardDescription>Configure article fetching limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Article Limit (for testing)</Label>
                <Select 
                  value={maxArticles?.toString() || "all"} 
                  onValueChange={(v) => setMaxArticles(v === "all" ? null : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">First 10 articles (max per source)</SelectItem>
                    <SelectItem value="20">First 20 articles</SelectItem>
                    <SelectItem value="50">First 50 articles</SelectItem>
                    <SelectItem value="all">All articles</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  ⚠️ Capped at 10 articles per source maximum to prevent timeouts. Only articles within the selected date range will be processed.
                </p>
              </div>
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
                          {format(new Date(query.created_at), "MMM d, HH:mm")}
                        </span>
                        {query.status === 'completed' && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                        {query.status === 'failed' && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        {query.status === 'running' && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
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
                        <div>Results: {query.artifacts_count || 0} artifacts, {query.stories_count || 0} stories</div>
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
    </div>
  );
};

export default ManualQuery;
