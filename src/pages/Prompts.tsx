import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromptCard } from "@/components/prompts/PromptCard";
import { TestPromptCard } from "@/components/prompts/TestPromptCard";
import { HistoryPromptCard } from "@/components/prompts/HistoryPromptCard";
import { EditPromptModal } from "@/components/prompts/EditPromptModal";
import { ActivatePromptModal } from "@/components/prompts/ActivatePromptModal";
import { ComparePromptsModal } from "@/components/prompts/ComparePromptsModal";
import { CardSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText } from "lucide-react";

const Prompts = () => {
  const queryClient = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<any>(null);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  const [comparePrompts, setComparePrompts] = useState<{ prompt1: any; prompt2: any } | null>(
    null
  );
  const [activeTab, setActiveTab] = useState("active");

  // Fetch active prompts
  const {
    data: activePrompts,
    isLoading: activeLoading,
    error: activeError,
    refetch: refetchActive,
  } = useQuery({
    queryKey: ["prompts", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_active", true)
        .eq("is_test_draft", false)
        .order("prompt_type");

      if (error) throw error;
      return data;
    },
  });

  // Fetch test drafts
  const {
    data: testDrafts,
    isLoading: testLoading,
    error: testError,
    refetch: refetchTest,
  } = useQuery({
    queryKey: ["prompts", "test-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_test_draft", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Fetch history
  const {
    data: historyPrompts,
    isLoading: historyLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useQuery({
    queryKey: ["prompts", "history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_test_draft", false)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Delete prompt mutation
  const deleteMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const { error } = await supabase.from("prompt_versions").delete().eq("id", promptId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      toast.success("Prompt deleted successfully");
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
    },
    onError: () => {
      toast.error("Failed to delete prompt");
    },
  });

  const handleDelete = (promptId: string) => {
    setPromptToDelete(promptId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (promptToDelete) {
      deleteMutation.mutate(promptToDelete);
    }
  };

  const handleEdit = (prompt: any) => {
    setSelectedPrompt(prompt);
    setEditModalOpen(true);
  };

  const handleCreateTestDraft = (prompt: any) => {
    const newVersionNumber = (parseFloat(prompt.version_name.match(/\d+\.\d+/)?.[0] || "1.0") + 0.1).toFixed(1);
    const promptType = prompt.prompt_type === "retrieval" ? "Retrieval" : "Journalism";
    
    setSelectedPrompt({
      ...prompt,
      version_name: `${promptType} v${newVersionNumber} DRAFT`,
      is_test_draft: true,
    });
    setEditModalOpen(true);
  };

  const handleActivate = (prompt: any) => {
    setSelectedPrompt(prompt);
    setActivateModalOpen(true);
  };

  const handleViewHistory = (promptType: string) => {
    setActiveTab("history");
  };

  const handleView = (prompt: any) => {
    setSelectedPrompt(prompt);
    setViewModalOpen(true);
  };

  const handleCompare = (prompt: any) => {
    // Get the previous version of the same type
    const sameTypePrompts = historyPrompts?.filter(
      (p) => p.prompt_type === prompt.prompt_type && p.id !== prompt.id
    );
    if (sameTypePrompts && sameTypePrompts.length > 0) {
      setComparePrompts({
        prompt1: prompt,
        prompt2: sameTypePrompts[0],
      });
      setCompareModalOpen(true);
    } else {
      toast.info("No other versions available for comparison");
    }
  };

  const handleCopyToTestDraft = async (prompt: any) => {
    try {
      const { error } = await supabase.from("prompt_versions").insert({
        version_name: `${prompt.version_name} COPY`,
        content: prompt.content,
        prompt_type: prompt.prompt_type,
        is_active: false,
        is_test_draft: true,
        update_notes: `Copied from ${prompt.version_name}`,
        based_on_version_id: prompt.id,
        test_status: "not_tested",
        author: "User",
      });

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      toast.success("Test draft created successfully");
      setActiveTab("test");
    } catch (error) {
      console.error("Error creating test draft:", error);
      toast.error("Failed to create test draft");
    }
  };

  const retrievalPrompt = activePrompts?.find((p) => p.prompt_type === "retrieval");
  const journalismPrompt = activePrompts?.find((p) => p.prompt_type === "journalism");

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Prompts</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="active">Active Prompts</TabsTrigger>
          <TabsTrigger value="test">Test Prompts</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-6">
          {activeLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : activeError ? (
            <ErrorState
              message="Failed to load active prompts. Please try again."
              onRetry={() => refetchActive()}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {retrievalPrompt && (
                <PromptCard
                  versionName={retrievalPrompt.version_name}
                  updatedAt={retrievalPrompt.updated_at}
                  isActive={retrievalPrompt.is_active}
                  onEdit={() => handleEdit(retrievalPrompt)}
                  onViewHistory={() => handleViewHistory("retrieval")}
                  onCreateTestDraft={() => handleCreateTestDraft(retrievalPrompt)}
                />
              )}
              {journalismPrompt && (
                <PromptCard
                  versionName={journalismPrompt.version_name}
                  updatedAt={journalismPrompt.updated_at}
                  isActive={journalismPrompt.is_active}
                  onEdit={() => handleEdit(journalismPrompt)}
                  onViewHistory={() => handleViewHistory("journalism")}
                  onCreateTestDraft={() => handleCreateTestDraft(journalismPrompt)}
                />
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          {testLoading ? (
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : testError ? (
            <ErrorState
              message="Failed to load test drafts. Please try again."
              onRetry={() => refetchTest()}
            />
          ) : testDrafts && testDrafts.length > 0 ? (
            testDrafts.map((draft) => (
              <TestPromptCard
                key={draft.id}
                id={draft.id}
                versionName={draft.version_name}
                basedOnVersionName={
                  historyPrompts?.find((p) => p.id === draft.based_on_version_id)?.version_name
                }
                testStatus={draft.test_status || "not_tested"}
                testResults={draft.test_results as { story_count?: number; date?: string } | undefined}
                updateNotes={draft.update_notes}
                onEdit={() => handleEdit(draft)}
                onViewResults={() => toast.info("View results functionality coming soon")}
                onActivate={() => handleActivate(draft)}
                onDelete={() => handleDelete(draft.id)}
              />
            ))
          ) : (
            <EmptyState
              icon={FileText}
              title="No test drafts yet"
              description="Create a test draft from the Active Prompts tab to start testing new prompt versions."
            />
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {historyLoading ? (
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : historyError ? (
            <ErrorState
              message="Failed to load prompt history. Please try again."
              onRetry={() => refetchHistory()}
            />
          ) : historyPrompts && historyPrompts.length > 0 ? (
            historyPrompts.map((prompt) => (
              <HistoryPromptCard
                key={prompt.id}
                id={prompt.id}
                versionName={prompt.version_name}
                createdAt={prompt.created_at}
                author={prompt.author || "System"}
                updateNotes={prompt.update_notes}
                isActive={prompt.is_active}
                onView={() => handleView(prompt)}
                onCompare={() => handleCompare(prompt)}
                onCopyToTestDraft={() => handleCopyToTestDraft(prompt)}
              />
            ))
          ) : (
            <EmptyState
              icon={FileText}
              title="No prompt history yet"
              description="Prompt versions will appear here as you create and activate them."
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Modal */}
      {selectedPrompt && (
        <EditPromptModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          promptId={selectedPrompt.id}
          promptType={selectedPrompt.prompt_type}
          currentContent={selectedPrompt.content}
          currentVersionName={selectedPrompt.version_name}
          isTestDraft={selectedPrompt.is_test_draft}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["prompts"] });
          }}
        />
      )}

      {/* Activate Modal */}
      {selectedPrompt && (
        <ActivatePromptModal
          open={activateModalOpen}
          onOpenChange={setActivateModalOpen}
          promptId={selectedPrompt.id}
          promptType={selectedPrompt.prompt_type}
          versionName={selectedPrompt.version_name}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["prompts"] });
          }}
        />
      )}

      {/* Compare Modal */}
      {comparePrompts && (
        <ComparePromptsModal
          open={compareModalOpen}
          onOpenChange={setCompareModalOpen}
          prompt1={comparePrompts.prompt1}
          prompt2={comparePrompts.prompt2}
        />
      )}

      {/* View Modal */}
      {selectedPrompt && (
        <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>{selectedPrompt.version_name}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              <pre className="text-sm whitespace-pre-wrap font-mono p-4">
                {selectedPrompt.content}
              </pre>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Prompt?"
        description="This will permanently remove this prompt version. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default Prompts;
