import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceCard } from "@/components/sources/SourceCard";
import { TestSourceCard } from "@/components/sources/TestSourceCard";
import { AddSourceForm } from "@/components/sources/AddSourceForm";
import { EditSourceModal } from "@/components/sources/EditSourceModal";
import { CardSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Database, Trash2 } from "lucide-react";

const Sources = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Record<string, unknown> | null>(null);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sourceToActivate, setSourceToActivate] = useState<Record<string, unknown> | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<string | null>(null);

  // Fetch active sources
  const {
    data: activeSources,
    isLoading: activeLoading,
    error: activeError,
    refetch: refetchActive,
  } = useQuery({
    queryKey: ["sources", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("status", "active")
        .order("name");

      if (error) throw error;
      return data;
    },
  });

  // Fetch test queue sources
  const {
    data: testSources,
    isLoading: testLoading,
    error: testError,
    refetch: refetchTest,
  } = useQuery({
    queryKey: ["sources", "testing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("status", "testing")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // Update source status mutation
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("sources")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
  });

  // Delete source mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // First, nullify source_id in related stories to avoid constraint violation
      const { error: storiesError } = await supabase
        .from("stories")
        .update({ source_id: null })
        .eq("source_id", id);
      
      if (storiesError) throw storiesError;

      // Then delete the source
      const { error } = await supabase.from("sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source removed successfully");
    },
    onError: (error: Error) => {
      console.error("Delete error:", error);
      toast.error("Failed to remove source. Please try again.");
    },
  });

  const handleEdit = (source: Record<string, unknown>) => {
    setSelectedSource(source);
    setEditModalOpen(true);
  };

  const handlePause = async (source: Record<string, unknown>) => {
    const newStatus = source.status === "active" ? "paused" : "active";
    try {
      await updateStatusMutation.mutateAsync({ id: source.id, status: newStatus });
      toast.success(
        newStatus === "active" ? "Source resumed successfully" : "Source paused successfully"
      );
    } catch (error) {
      toast.error("Failed to update source status");
    }
  };

  const handleRemove = (sourceId: string) => {
    setSourceToDelete(sourceId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (sourceToDelete) {
      deleteMutation.mutate(sourceToDelete);
      setDeleteDialogOpen(false);
      setSourceToDelete(null);
    }
  };

  const handleActivate = (source: Record<string, unknown>) => {
    setSourceToActivate(source);
    setActivateDialogOpen(true);
  };

  const confirmActivate = async () => {
    if (!sourceToActivate) return;

    try {
      await updateStatusMutation.mutateAsync({
        id: sourceToActivate.id,
        status: "active",
      });
      toast.success("Source activated successfully");
      setActivateDialogOpen(false);
      setSourceToActivate(null);
    } catch (error) {
      toast.error("Failed to activate source");
    }
  };

  const handleViewTestArtifacts = (sourceId: string) => {
    navigate("/artifacts", {
      state: {
        sourceId,
        environment: "test",
      },
    });
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Sources</h1>
      </div>

      <Tabs defaultValue="active" className="mb-8">
        <TabsList className="mb-6">
          <TabsTrigger value="active">
            Active Sources {activeSources && `(${activeSources.length})`}
          </TabsTrigger>
          <TabsTrigger value="test">
            Test Queue {testSources && `(${testSources.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-4">
          {activeLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : activeError ? (
            <ErrorState
              message="Failed to load active sources. Please try again."
              onRetry={() => refetchActive()}
            />
          ) : activeSources && activeSources.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeSources.map((source) => (
                <SourceCard
                  key={source.id}
                  id={source.id}
                  name={source.name}
                  url={source.url}
                  type={source.type}
                  lastFetchAt={source.last_fetch_at}
                  itemsFetched={source.items_fetched || 0}
                  status={source.status}
                  parserConfig={source.parser_config}
                  onEdit={() => handleEdit(source)}
                  onPause={() => handlePause(source)}
                  onRemove={() => handleRemove(source.id)}
                  onRefresh={() => refetchActive()}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Database}
              title="No active sources yet"
              description="Add sources to the test queue and activate them after testing to start collecting content."
            />
          )}
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          {testLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : testError ? (
            <ErrorState
              message="Failed to load test queue sources. Please try again."
              onRetry={() => refetchTest()}
            />
          ) : testSources && testSources.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {testSources.map((source) => (
                <TestSourceCard
                  key={source.id}
                  id={source.id}
                  name={source.name}
                  url={source.url}
                  type={source.type}
                  lastFetchAt={source.last_fetch_at}
                  itemsFetched={source.items_fetched || 0}
                  parserConfig={source.parser_config}
                  onActivate={() => handleActivate(source)}
                  onRemove={() => handleRemove(source.id)}
                  onViewTestArtifacts={() => handleViewTestArtifacts(source.id)}
                  onRefresh={() => refetchTest()}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Database}
              title="No sources in test queue"
              description="Add a new source below to start testing it before activating for production use."
            />
          )}
        </TabsContent>
      </Tabs>

      <AddSourceForm
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ["sources"] });
        }}
      />

      {/* Edit Modal */}
      {selectedSource && (
        <EditSourceModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          source={selectedSource}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["sources"] });
          }}
        />
      )}

      {/* Activate Confirmation Dialog */}
      <ConfirmDialog
        open={activateDialogOpen}
        onOpenChange={setActivateDialogOpen}
        title="Activate Source?"
        description={`This will move ${sourceToActivate?.name} to active sources and include it in all future daily runs.`}
        confirmLabel="Activate"
        onConfirm={confirmActivate}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Source?"
        description="This will permanently remove this source. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </div>
  );
};

export default Sources;
