import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EditPromptModal } from "@/components/prompts/EditPromptModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScheduleTimeSelector } from "@/components/scheduling/ScheduleTimeSelector";
import { SaveScheduleButton } from "@/components/scheduling/SaveScheduleButton";
import { useSchedule } from "@/hooks/useSchedules";
import { toast } from "sonner";
import { Loader2, Sparkles, CheckCircle, Edit, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { formatUTCtoEST } from "@/lib/time-utils";

const AIEditor = () => {
  const queryClient = useQueryClient();

  // Run tab state
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ published?: number; rejected?: number; featured?: number; skipped?: number; errors?: number } | null>(null);

  // Schedule tab state
  const [editorScheduleTimes, setEditorScheduleTimes] = useState<string[]>([]);
  const [editorScheduleEnabled, setEditorScheduleEnabled] = useState(false);

  // Prompt tab state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Record<string, unknown> | null>(null);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editMode, setEditMode] = useState<"direct" | "new_version">("direct");
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ prompt: Record<string, unknown>; mode: "direct" | "new_version" } | null>(null);

  // Load existing schedule
  const { data: editorSchedule } = useSchedule("ai_editor");

  useEffect(() => {
    if (editorSchedule) {
      setEditorScheduleTimes(editorSchedule.scheduled_times || []);
      setEditorScheduleEnabled(editorSchedule.is_enabled);
    }
  }, [editorSchedule]);

  // Fetch cron job logs for run-editor
  const { data: cronLogs } = useQuery({
    queryKey: ["cron-logs-editor"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cron_job_logs")
        .select("*")
        .eq("job_name", "run-editor")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  // Fetch editor prompts
  const { data: prompts, isLoading: promptsLoading } = useQuery({
    queryKey: ["editor-prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("prompt_type", "editor")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Run AI Editor mutation
  const runMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("run-ai-editor");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setRunResult(data);
      setIsRunning(false);
      queryClient.invalidateQueries({ queryKey: ["cron-logs-editor"] });
      toast.success("AI Editor run complete");
    },
    onError: (error: Error) => {
      setIsRunning(false);
      toast.error(`AI Editor failed: ${error.message}`);
    },
  });

  const handleRun = () => {
    setIsRunning(true);
    setRunResult(null);
    runMutation.mutate();
  };

  // Delete prompt mutation
  const deleteMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const { error } = await supabase.from("prompt_versions").delete().eq("id", promptId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["editor-prompts"] });
      toast.success("Prompt deleted successfully");
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(error?.message || "Failed to delete prompt");
      setDeleteDialogOpen(false);
    },
  });

  // Make active mutation
  const makeActiveMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const prompt = prompts?.find((p) => p.id === promptId);
      if (!prompt) throw new Error("Prompt not found");

      const { error: deactivateError } = await supabase
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("prompt_type", prompt.prompt_type);
      if (deactivateError) throw deactivateError;

      const { error: activateError } = await supabase
        .from("prompt_versions")
        .update({ is_active: true })
        .eq("id", promptId);
      if (activateError) throw activateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["editor-prompts"] });
      toast.success("Prompt activated successfully");
    },
    onError: () => {
      toast.error("Failed to activate prompt");
    },
  });

  const handleEdit = (prompt: Record<string, unknown>, mode: "direct" | "new_version") => {
    if (mode === "direct" && prompt.is_active) {
      setPendingEdit({ prompt, mode });
      setEditConfirmOpen(true);
    } else {
      setSelectedPrompt(prompt);
      setEditMode(mode);
      setIsCreating(false);
      setEditModalOpen(true);
    }
  };

  const handleCreateNew = () => {
    setSelectedPrompt(null);
    setIsCreating(true);
    setEditModalOpen(true);
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">AI Editor</h1>
        <p className="text-muted-foreground">
          Review and polish draft stories using AI editing
        </p>
      </div>

      <Tabs defaultValue="run" className="space-y-6">
        <TabsList>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
        </TabsList>

        {/* Run Tab */}
        <TabsContent value="run" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Run AI Editor</CardTitle>
              <CardDescription>
                Process all pending draft stories through the AI editor
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button size="lg" onClick={handleRun} disabled={isRunning}>
                {isRunning ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-5 w-5" />
                    Run AI Editor Now
                  </>
                )}
              </Button>

              {runResult && (
                <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
                  <p className="text-sm font-medium">Last Run Results</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>Published: <span className="font-medium text-green-600">{runResult.published ?? 0}</span></div>
                    <div>Featured: <span className="font-medium text-yellow-600">{runResult.featured ?? 0}</span></div>
                    <div>Rejected: <span className="font-medium text-red-600">{runResult.rejected ?? 0}</span></div>
                    <div>Skipped: <span className="font-medium text-muted-foreground">{runResult.skipped ?? 0}</span></div>
                    <div>Errors: <span className="font-medium text-orange-600">{runResult.errors ?? 0}</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent cron logs */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Scheduled Runs</CardTitle>
              <CardDescription>Last 5 automated editor runs</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {cronLogs?.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No scheduled runs yet</p>
                ) : (
                  cronLogs?.map((log) => (
                    <div key={log.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{formatUTCtoEST(log.created_at)}</span>
                        {log.schedule_check_passed ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <span className="text-xs text-red-500">{log.error_message ? 'error' : 'skipped'}</span>
                        )}
                      </div>
                      {log.reason && (
                        <p className="text-xs text-muted-foreground">{log.reason}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Editor Schedule</CardTitle>
              <CardDescription>
                Configure when to automatically run the AI editor
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="editor-enabled">Enable Scheduled Editing</Label>
                <Switch
                  id="editor-enabled"
                  checked={editorScheduleEnabled}
                  onCheckedChange={setEditorScheduleEnabled}
                />
              </div>

              <ScheduleTimeSelector
                scheduledTimes={editorScheduleTimes}
                onChange={setEditorScheduleTimes}
                label="Editor Run Times"
                description="Choose specific times each day to run the AI editor (ET timezone)"
                presets={[
                  { label: "8 AM ET", time: "08:00" },
                  { label: "2 PM ET", time: "14:00" },
                  { label: "8 PM ET", time: "20:00" },
                ]}
              />

              <SaveScheduleButton
                scheduleType="ai_editor"
                times={editorScheduleTimes}
                enabled={editorScheduleEnabled}
              />
            </CardContent>
          </Card>

          <Alert>
            <AlertDescription>
              <strong>Tip:</strong> Runs 1 hour after the journalism pipeline (07:00, 13:00, 19:00 ET) to ensure new stories are ready for editing.
            </AlertDescription>
          </Alert>
        </TabsContent>

        {/* Prompt Tab */}
        <TabsContent value="prompt" className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Editor prompt versions</p>
            <Button onClick={handleCreateNew} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Prompt
            </Button>
          </div>

          {promptsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(2)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-6 bg-muted rounded w-3/4 mb-2" />
                    <div className="h-4 bg-muted rounded w-1/2" />
                  </CardHeader>
                  <CardContent>
                    <div className="h-20 bg-muted rounded" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : !prompts || prompts.length === 0 ? (
            <Card className="p-12">
              <div className="text-center">
                <h3 className="text-xl font-semibold mb-2">No editor prompts yet</h3>
                <p className="text-muted-foreground mb-4">Create your first editor prompt to get started</p>
                <Button onClick={handleCreateNew}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Prompt
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {prompts.map((prompt) => (
                <Card
                  key={prompt.id}
                  className={`relative transition-all ${
                    prompt.is_active
                      ? "border-primary shadow-lg ring-2 ring-primary/20"
                      : "hover:border-primary/50"
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-2 flex items-center gap-2">
                          {prompt.version_name}
                          {prompt.is_active && (
                            <Badge variant="default" className="ml-2">
                              <CheckCircle className="mr-1 h-3 w-3" />
                              Active
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs space-y-1">
                          <div>Updated: {format(new Date(prompt.updated_at), "MMM d, yyyy")}</div>
                          {prompt.author && <div>By: {prompt.author}</div>}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground line-clamp-3">
                      {prompt.content.substring(0, 150)}...
                    </div>
                    {prompt.update_notes && (
                      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                        <strong>Notes:</strong> {prompt.update_notes}
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(prompt, "direct")}>
                      <Edit className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleEdit(prompt, "new_version")}>
                      <Plus className="mr-1 h-3 w-3" />
                      New Version
                    </Button>
                    {!prompt.is_active && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => makeActiveMutation.mutate(prompt.id)}
                        disabled={makeActiveMutation.isPending}
                      >
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Activate
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setPromptToDelete(prompt.id);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <EditPromptModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        promptId={isCreating ? null : selectedPrompt?.id}
        promptType="editor"
        currentContent={selectedPrompt?.content || ""}
        currentVersionName={selectedPrompt?.version_name || ""}
        isTestDraft={false}
        editMode={editMode}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["editor-prompts"] });
          setEditModalOpen(false);
        }}
      />

      <ConfirmDialog
        open={editConfirmOpen}
        onOpenChange={setEditConfirmOpen}
        title="Edit Active Prompt?"
        description="This prompt is currently active. Changes will take effect immediately. Consider creating a new version instead."
        confirmLabel="Edit Anyway"
        variant="default"
        onConfirm={() => {
          if (pendingEdit) {
            setSelectedPrompt(pendingEdit.prompt);
            setEditMode(pendingEdit.mode);
            setIsCreating(false);
            setEditModalOpen(true);
            setPendingEdit(null);
          }
          setEditConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Prompt?"
        description="This will permanently remove this prompt version. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (promptToDelete) deleteMutation.mutate(promptToDelete);
        }}
      />
    </div>
  );
};

export default AIEditor;
