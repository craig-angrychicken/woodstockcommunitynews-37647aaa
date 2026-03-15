import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EditPromptModal } from "@/components/prompts/EditPromptModal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { Plus, Edit, CheckCircle, Trash2 } from "lucide-react";
import { format } from "date-fns";

const Prompts = () => {
  const queryClient = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<Record<string, unknown> | null>(null);
  const [promptToDelete, setPromptToDelete] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editMode, setEditMode] = useState<"direct" | "new_version">("direct");
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ prompt: Record<string, unknown>; mode: "direct" | "new_version" } | null>(null);

  // Fetch all prompts
  const {
    data: prompts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["prompts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("prompt_type", "journalism")
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
    onError: (error: Error) => {
      console.error("Delete error:", error);
      toast.error(
        error?.message || "Failed to delete prompt. Please try again."
      );
      setDeleteDialogOpen(false);
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

  const handleEdit = (prompt: Record<string, unknown>, mode: "direct" | "new_version") => {
    if (mode === "direct" && prompt.is_active) {
      // Show confirmation for active prompts
      setPendingEdit({ prompt, mode });
      setEditConfirmOpen(true);
    } else {
      // Proceed directly for non-active prompts or new versions
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

  // Make active mutation
  const makeActiveMutation = useMutation({
    mutationFn: async (promptId: string) => {
      const prompt = prompts?.find(p => p.id === promptId);
      if (!prompt) throw new Error("Prompt not found");

      // Deactivate other prompts of the same type
      const { error: deactivateError } = await supabase
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("prompt_type", prompt.prompt_type);

      if (deactivateError) throw deactivateError;

      // Activate selected prompt
      const { error: activateError } = await supabase
        .from("prompt_versions")
        .update({ is_active: true })
        .eq("id", promptId);

      if (activateError) throw activateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompts"] });
      toast.success("Prompt activated successfully");
    },
    onError: () => {
      toast.error("Failed to activate prompt");
    },
  });

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Prompts</h1>
          <p className="text-muted-foreground">Manage your AI prompt versions</p>
        </div>
        <Button onClick={handleCreateNew} size="lg">
          <Plus className="mr-2 h-5 w-5" />
          Add Prompt
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
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
      ) : error ? (
        <Card className="p-8">
          <div className="text-center">
            <p className="text-destructive mb-4">Failed to load prompts</p>
            <Button onClick={() => refetch()}>Try Again</Button>
          </div>
        </Card>
      ) : !prompts || prompts.length === 0 ? (
        <Card className="p-12">
          <div className="text-center">
            <h3 className="text-xl font-semibold mb-2">No prompts yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first prompt to get started
            </p>
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(prompt, "direct")}
                >
                  <Edit className="mr-1 h-3 w-3" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEdit(prompt, "new_version")}
                >
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
                  onClick={() => handleDelete(prompt.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Edit/Create Modal */}
      <EditPromptModal
        open={editModalOpen}
        onOpenChange={setEditModalOpen}
        promptId={isCreating ? null : selectedPrompt?.id as string | undefined}
        currentContent={(selectedPrompt?.content as string) || ""}
        currentVersionName={(selectedPrompt?.version_name as string) || ""}
        isTestDraft={false}
        editMode={editMode}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["prompts"] });
          setEditModalOpen(false);
        }}
      />

      {/* Edit Active Prompt Confirmation Dialog */}
      <ConfirmDialog
        open={editConfirmOpen}
        onOpenChange={setEditConfirmOpen}
        title="Edit Active Prompt?"
        description="This prompt is currently active and being used in production. Changes will take effect immediately. Consider creating a new version instead if you want to test changes first."
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
