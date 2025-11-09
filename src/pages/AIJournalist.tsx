import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { CalendarIcon, Loader2, Sparkles, CheckCircle, XCircle, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const AIJournalist = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [dateFrom, setDateFrom] = useState<Date>(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [dateTo, setDateTo] = useState<Date>(new Date());
  const [environment, setEnvironment] = useState<"production" | "test">("test");
  const [promptMode, setPromptMode] = useState<"active" | "select">("active");
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<string>("");
  const [maxArtifacts, setMaxArtifacts] = useState<number | null>(20);
  const [isRunning, setIsRunning] = useState(false);
  const [activeQuickDate, setActiveQuickDate] = useState<number | null>(7);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<"dateRange" | "specific">("dateRange");
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);

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

  // Fetch available artifacts for specific selection mode
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

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
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
        .eq('run_stages', 'manual')
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
    const estimatedStories = Math.min(artifactsCount || 0, maxArtifacts || 999999) / 3;
    const costPerStory = 0.05; // Rough cost estimate
    return (estimatedStories * costPerStory).toFixed(2);
  }, [artifactsCount, maxArtifacts]);

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
        historyId: historyRecord.id,
        maxArtifacts
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
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ai-journalist-history'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      
      toast({
        title: "AI Journalist Complete!",
        description: data.message,
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    },
    onError: (error: Error) => {
      toast({
        title: "AI Journalist Failed",
        description: error.message,
        variant: "destructive"
      });
      setIsRunning(false);
      setCurrentHistoryId(null);
    }
  });

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

          {/* Run Options */}
          <Card>
            <CardHeader>
              <CardTitle>Run Options</CardTitle>
              <CardDescription>Configure AI processing limits</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Artifact Limit (for testing)</Label>
                <Select 
                  value={maxArtifacts?.toString() || "all"} 
                  onValueChange={(v) => setMaxArtifacts(v === "all" ? null : parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">First 10 artifacts</SelectItem>
                    <SelectItem value="20">First 20 artifacts (recommended)</SelectItem>
                    <SelectItem value="50">First 50 artifacts</SelectItem>
                    <SelectItem value="100">First 100 artifacts</SelectItem>
                    <SelectItem value="all">All artifacts</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The AI will process up to this many artifacts to generate stories
                </p>
              </div>

              <div className="pt-2 border-t">
                <p className="text-sm">
                  <span className="font-semibold">Estimated cost:</span> ${costEstimate}
                </p>
              </div>
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
    </div>
  );
};

export default AIJournalist;
