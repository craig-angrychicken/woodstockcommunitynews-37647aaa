import { useState, useMemo } from "react";
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
import { CalendarIcon, Loader2, Play, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
  const [runStages, setRunStages] = useState<"stage1" | "both">("both");
  const [isRunning, setIsRunning] = useState(false);

  // Fetch sources
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sources')
        .select('*')
        .eq('status', 'active')
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
      return data;
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
          run_stages: runStages,
          status: 'running'
        })
        .select()
        .single();

      if (historyError) throw historyError;

      // Call edge function
      const { data, error } = await supabase.functions.invoke('run-manual-query', {
        body: {
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
          sourceIds: selectedSources,
          environment,
          promptVersionId,
          runStages,
          historyId: historyRecord.id
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
    },
    onError: (error: Error) => {
      toast({
        title: "Query Failed",
        description: error.message,
        variant: "destructive"
      });
      setIsRunning(false);
    }
  });

  const handleRunQuery = () => {
    setIsRunning(true);
    runQueryMutation.mutate();
  };

  const handleQuickDate = (days: number) => {
    const newDateFrom = new Date();
    newDateFrom.setDate(newDateFrom.getDate() - days);
    setDateFrom(newDateFrom);
    setDateTo(new Date());
  };

  const handleSelectAllSources = () => {
    setSelectedSources(sources?.map(s => s.id) || []);
  };

  const handleSelectNoneSources = () => {
    setSelectedSources([]);
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
        <h1 className="text-3xl font-bold mb-2">Manual Query</h1>
        <p className="text-muted-foreground">
          Run custom queries to fetch sources and generate stories
        </p>
      </div>

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
                        onSelect={(date) => date && setDateFrom(date)}
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
                        onSelect={(date) => date && setDateTo(date)}
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleQuickDate(7)}>
                  Last 7 days
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleQuickDate(30)}>
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
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                    >
                      {source.name}
                      <span className="text-muted-foreground text-xs ml-2">({source.type})</span>
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
              <CardDescription>Choose what stages to execute</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup value={runStages} onValueChange={(v: any) => setRunStages(v)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="stage1" id="stage1-only" />
                  <Label htmlFor="stage1-only" className="cursor-pointer">
                    Stage 1 Only (Fetch Sources)
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="both" id="both-stages" />
                  <Label htmlFor="both-stages" className="cursor-pointer">
                    Both Stages (Fetch + Generate Stories)
                  </Label>
                </div>
              </RadioGroup>

              <div className="space-y-2 text-sm text-muted-foreground">
                <p><strong>Stage 1:</strong> Fetches data from selected sources and saves as artifacts</p>
                <p><strong>Stage 2:</strong> Uses AI to generate news articles from artifacts</p>
              </div>

              <div className="pt-2 border-t">
                <p className="text-sm">
                  <span className="font-semibold">Estimated cost:</span> ${costEstimate}
                </p>
              </div>
            </CardContent>
          </Card>

          <Button
            size="lg"
            className="w-full"
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
                Run Query
              </>
            )}
          </Button>
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
                        <div>Results: {query.artifacts_count} artifacts, {query.stories_count} stories</div>
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
