import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CalendarIcon, Loader2, Sparkles, CheckCircle, XCircle, X, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { formatUTCtoEST } from "@/lib/time-utils";
import { QueueProcessor } from "@/components/ai-journalist/QueueProcessor";
import { ScheduleTimeSelector } from "@/components/scheduling/ScheduleTimeSelector";
import { SaveScheduleButton } from "@/components/scheduling/SaveScheduleButton";
import { useSchedule } from "@/hooks/useSchedules";

const AIJournalist = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [dateFrom, setDateFrom] = useState<Date>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [environment, setEnvironment] = useState<"production" | "test">("test");
  const [promptMode, setPromptMode] = useState<"active" | "select">("active");
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [activeQuickDate, setActiveQuickDate] = useState<number | null>(7);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"dateRange" | "specific">("dateRange");
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  
  // Scheduling state
  const [journalismScheduleTimes, setJournalismScheduleTimes] = useState<string[]>([]);
  const [journalismScheduleEnabled, setJournalismScheduleEnabled] = useState(false);
  
  // Load existing schedule
  const { data: journalismSchedule } = useSchedule("ai_journalism");
  
  useEffect(() => {
    if (journalismSchedule) {
      setJournalismScheduleTimes(journalismSchedule.scheduled_times || []);
      setJournalismScheduleEnabled(journalismSchedule.is_enabled);
    }
  }, [journalismSchedule]);

  // Check for most recent query on page load (running or completed)
  useEffect(() => {
    const checkLatestQuery = async () => {
      const { data: latestRun } = await supabase
        .from('query_history')
        .select('id, status')
        .in('run_stages', ['manual', 'automated'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (latestRun) {
        setCurrentHistoryId(latestRun.id);
        setIsRunning(latestRun.status === 'running');
      }
    };
    
    checkLatestQuery();
  }, []);

  // Fetch prompt versions
  const { data: promptVersions } = useQuery({
    queryKey: ['prompt-versions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prompt_versions')
        .select('*')
        .eq('prompt_type', 'journalism')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  // Fetch available artifacts for specific selection mode (excluding already-used artifacts)
  const { data: availableArtifacts } = useQuery({
    queryKey: ['available-artifacts', dateFrom, dateTo, environment, selectionMode],
    queryFn: async () => {
      if (selectionMode === "specific") {
        let query = supabase
          .from('artifacts')
          .select('*')
          .order('date', { ascending: false });

        if (environment === 'test') {
          query = query.eq('is_test', true);
        } else {
          query = query.eq('is_test', false);
        }

        const { data: artifactsData, error: artifactsError } = await query;
        if (artifactsError) throw artifactsError;

        // Get all artifact IDs that are already used in stories
        const { data: usedArtifacts, error: usedError } = await supabase
          .from('story_artifacts')
          .select('artifact_id');

        if (usedError) throw usedError;

        const usedArtifactIds = new Set(usedArtifacts?.map(sa => sa.artifact_id) || []);

        // Filter out used artifacts
        const unusedArtifacts = artifactsData?.filter(a => !usedArtifactIds.has(a.id)) || [];

        return unusedArtifacts;
      }
      return [];
    },
    enabled: selectionMode === "specific"
  });

  // Fetch count for date range mode
  const { data: dateRangeCount } = useQuery({
    queryKey: ['artifacts-count', dateFrom, dateTo, environment],
    queryFn: async () => {
      let query = supabase
        .from('artifacts')
        .select('*', { count: 'exact', head: true })
        .gte('date', dateFrom.toISOString())
        .lte('date', dateTo.toISOString());

      if (environment === 'test') {
        query = query.eq('is_test', true);
      } else {
        query = query.eq('is_test', false);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled: selectionMode === "dateRange"
  });

  const artifactsCount = selectionMode === "dateRange" 
    ? (dateRangeCount || 0)
    : selectedArtifactIds.length;

  // Fetch query history for AI runs
  const { data: queryHistory } = useQuery({
    queryKey: ['ai-journalist-history'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('query_history')
        .select(`
          *,
          prompt_versions!inner (version_name, prompt_type)
        `)
        .in('run_stages', ['manual', 'automated'])
        .eq('prompt_versions.prompt_type', 'journalism')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    }
  });

  const activePromptVersion = useMemo(
    () => promptVersions?.find(p => p.is_active),
    [promptVersions]
  );

  const costEstimate = useMemo(() => {
    const estimatedStories = (artifactsCount || 0) / 3;
    const costPerStory = 0.05; // Rough cost estimate
    return (estimatedStories * costPerStory).toFixed(2);
  }, [artifactsCount]);

  // Cancel mutation
  const cancelMutation = useMutation({
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
      queryClient.invalidateQueries({ queryKey: ['ai-journalist-history'] });
      toast({
        title: "AI Run Cancelled",
        description: "The AI journalist run has been stopped.",
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

  // Run AI journalist mutation
  const runMutation = useMutation({
    mutationFn: async () => {
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
          source_ids: [],
          run_stages: 'manual',
          status: 'running'
        })
        .select()
        .single();

      if (historyError) throw historyError;

      setCurrentHistoryId(historyRecord.id);

      // Call edge function with either date range or specific artifact IDs
      const body: any = {
        environment,
        promptVersionId,
        historyId: historyRecord.id
      };

      if (selectionMode === 'specific') {
        body.artifactIds = selectedArtifactIds;
      } else {
        body.dateFrom = dateFrom.toISOString();
        body.dateTo = dateTo.toISOString();
      }

      const { data, error } = await supabase.functions.invoke('run-ai-journalist', {
        body
      });

      if (error) throw error;
      return { historyId: historyRecord.id, ...data };
    },
    onSuccess: (data) => {
      // Show immediate success message
      const count = data.queueSize ?? data.artifactsCount ?? 0;
      toast({
        title: "AI Journalist Started",
        description: `Processing ${count} artifacts in the background. Check history for progress.`,
      });
      
      // Invalidate queries to refresh history list
      queryClient.invalidateQueries({ queryKey: ['ai-journalist-history'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Start AI Journalist",
        description: error.message,
        variant: "destructive"
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    }
  });

  // Poll for status updates when running
  useEffect(() => {
    if (!isRunning || !currentHistoryId) return;

    const pollInterval = setInterval(async () => {
      // Check if there are any pending or processing items in the queue
      const { data: queueItems, error: queueError } = await supabase
        .from('journalism_queue')
        .select('status')
        .eq('query_history_id', currentHistoryId)
        .in('status', ['pending', 'processing']);

      if (queueError) {
        console.error('Error polling queue:', queueError);
        return;
      }

      // If no items are pending or processing, check final status
      if (!queueItems || queueItems.length === 0) {
        const { data: history, error: historyError } = await supabase
          .from('query_history')
          .select('status, stories_count, error_message')
          .eq('id', currentHistoryId)
          .single();

        if (historyError) {
          console.error('Error fetching history:', historyError);
          return;
        }

        setIsRunning(false);
        
        queryClient.invalidateQueries({ queryKey: ['ai-journalist-history'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
        queryClient.invalidateQueries({ queryKey: ['stories'] });
        
        if (history.status === 'completed') {
          toast({
            title: "AI Journalist Complete!",
            description: `Generated ${history.stories_count} stories`,
          });
        } else if (history.status === 'failed') {
          toast({
            title: "AI Journalist Failed",
            description: history.error_message || "Unknown error",
            variant: "destructive"
          });
        } else if (history.status === 'cancelled') {
          toast({
            title: "AI Journalist Cancelled",
            description: "The process was stopped by user"
          });
        }
        // Keep currentHistoryId set so the completed run stays visible
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [isRunning, currentHistoryId, queryClient, toast]);

  const handleRun = () => {
    setIsRunning(true);
    runMutation.mutate();
  };

  const handleCancel = () => {
    if (currentHistoryId) {
      cancelMutation.mutate(currentHistoryId);
    }
  };

  const handleQuickDate = (days: number) => {
    const newDateFrom = new Date();
    newDateFrom.setDate(newDateFrom.getDate() - days);
    setDateFrom(newDateFrom);
    setDateTo(new Date());
    setActiveQuickDate(days);
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">AI Journalist</h1>
        <p className="text-muted-foreground">
          Generate news stories from your stored artifacts using AI
        </p>
      </div>

      {/* Editorial Pipeline Stages */}
      <Card>
        <CardContent className="py-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Editorial Pipeline</p>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { label: "Pending", description: "AI generates draft from artifacts" },
              { label: "Fact Checked", description: "AI verifies claims against sources" },
              { label: "Edited", description: "AI rewrites for style and clarity" },
              { label: "Published / Rejected", description: "Final review and publish to Ghost" },
            ].map((stage, index) => (
              <div key={stage.label} className="flex items-center gap-1">
                {index > 0 && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 flex-shrink-0" />}
                <div className="group relative">
                  <Badge variant="outline" className="text-xs whitespace-nowrap cursor-default">
                    {index + 1}. {stage.label}
                  </Badge>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-popover text-popover-foreground border rounded shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20">
                    {stage.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="run" className="space-y-6">
        <TabsList>
          <TabsTrigger value="run">Run AI Journalist</TabsTrigger>
          <TabsTrigger value="schedule">Scheduling</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-6">
          {/* Queue Processor - Shows active or last run status */}
          {currentHistoryId && (
            <QueueProcessor 
              historyId={currentHistoryId}
              isRunning={isRunning}
              onDismiss={!isRunning ? () => {
                setCurrentHistoryId(null);
                setIsRunning(false);
              } : undefined}
            />
          )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Artifact Selection Mode */}
          <Card>
            <CardHeader>
              <CardTitle>Artifact Selection</CardTitle>
              <CardDescription>
                Choose how to select artifacts ({artifactsCount} selected)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={selectionMode} onValueChange={(v: any) => {
                setSelectionMode(v);
                setSelectedArtifactIds([]);
              }}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dateRange" id="date-range" />
                  <Label htmlFor="date-range" className="cursor-pointer">
                    Date Range
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="specific" id="specific" />
                  <Label htmlFor="specific" className="cursor-pointer">
                    Select Specific Artifacts
                  </Label>
                </div>
              </RadioGroup>

              {selectionMode === "dateRange" ? (
                <div className="space-y-4 pt-4">
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
                </div>
              ) : (
                <div className="space-y-4 pt-4">
                  <div className="max-h-96 overflow-y-auto border rounded-lg">
                    {availableArtifacts && availableArtifacts.length > 0 ? (
                      <div className="divide-y">
                        <div className="p-3 bg-muted/50 sticky top-0 z-10">
                          <Label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="rounded border-input"
                              checked={selectedArtifactIds.length === availableArtifacts.length}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedArtifactIds(availableArtifacts.map(a => a.id));
                                } else {
                                  setSelectedArtifactIds([]);
                                }
                              }}
                            />
                            <span className="font-medium">
                              Select All ({availableArtifacts.length} artifacts)
                            </span>
                          </Label>
                        </div>
                        {availableArtifacts.map((artifact) => (
                          <div key={artifact.id} className="p-3 hover:bg-muted/50 transition-colors">
                            <Label className="flex items-start space-x-3 cursor-pointer">
                              <input
                                type="checkbox"
                                className="mt-1 rounded border-input"
                                checked={selectedArtifactIds.includes(artifact.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedArtifactIds([...selectedArtifactIds, artifact.id]);
                                  } else {
                                    setSelectedArtifactIds(selectedArtifactIds.filter(id => id !== artifact.id));
                                  }
                                }}
                              />
                              <div className="flex-1 space-y-1">
                                <p className="font-medium leading-tight">
                                  {artifact.title || artifact.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(new Date(artifact.date), "MMM d, yyyy")}
                                </p>
                              </div>
                            </Label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No artifacts available
                      </p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Environment Section */}
          <Card>
            <CardHeader>
              <CardTitle>Environment</CardTitle>
              <CardDescription>Choose which artifacts to process</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={environment} onValueChange={(v: any) => setEnvironment(v)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="production" id="prod" />
                  <Label htmlFor="prod" className="cursor-pointer">
                    Production Artifacts
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="test" id="test" />
                  <Label htmlFor="test" className="cursor-pointer">
                    Test Artifacts
                  </Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Prompt Version Section */}
          <Card>
            <CardHeader>
              <CardTitle>Prompt Version</CardTitle>
              <CardDescription>Select which prompt version to use for generation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={promptMode} onValueChange={(v: any) => setPromptMode(v)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="active" id="active-prompt" />
                  <Label htmlFor="active-prompt" className="cursor-pointer">
                    Use Active Version
                    {activePromptVersion && (
                      <span className="text-muted-foreground ml-2">
                        ({activePromptVersion.version_name})
                      </span>
                    )}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="select" id="select-prompt" />
                  <Label htmlFor="select-prompt" className="cursor-pointer">
                    Select Specific Version
                  </Label>
                </div>
              </RadioGroup>

              {promptMode === 'select' && (
                <Select value={selectedPromptVersion} onValueChange={setSelectedPromptVersion}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a version" />
                  </SelectTrigger>
                  <SelectContent>
                    {promptVersions?.map(version => (
                      <SelectItem key={version.id} value={version.id}>
                        {version.version_name}
                        {version.is_active && " (Active)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>


          <div className="flex gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={handleRun}
              disabled={isRunning || artifactsCount === 0}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Generating Stories...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-5 w-5" />
                  Run AI Journalist
                </>
              )}
            </Button>
            
            {isRunning && (
              <Button
                size="lg"
                variant="destructive"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
        </div>

        {/* History Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle>AI Run History</CardTitle>
              <CardDescription>Recent AI journalist runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {queryHistory?.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No AI runs yet
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
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                      </div>
                      <div className="text-xs space-y-1 text-muted-foreground">
                        <div>Environment: {query.environment}</div>
                        <div>Prompt: {query.prompt_versions?.version_name}</div>
                        <div>Generated: {query.stories_count} stories</div>
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

        <TabsContent value="schedule" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Journalism Schedule</CardTitle>
              <CardDescription>
                Configure when to automatically generate stories from fetched artifacts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="journalism-enabled">Enable Scheduled Journalism</Label>
                <Switch
                  id="journalism-enabled"
                  checked={journalismScheduleEnabled}
                  onCheckedChange={setJournalismScheduleEnabled}
                />
              </div>

              <ScheduleTimeSelector
                scheduledTimes={journalismScheduleTimes}
                onChange={setJournalismScheduleTimes}
                label="Story Generation Times"
                description="Choose specific times each day to generate stories (ET timezone)"
                presets={[
                  { label: "6 AM ET", time: "06:00" },
                  { label: "12 PM ET", time: "12:00" },
                  { label: "6 PM ET", time: "18:00" },
                ]}
              />

              <SaveScheduleButton
                scheduleType="ai_journalism"
                times={journalismScheduleTimes}
                enabled={journalismScheduleEnabled}
              />
            </CardContent>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>Tip:</strong> Schedule AI journalism to run after artifact fetching (configured in the Fetch tab) to ensure new content is available for processing.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIJournalist;
