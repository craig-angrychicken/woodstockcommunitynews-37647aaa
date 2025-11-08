import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SourceCard } from "@/components/sources/SourceCard";
import { TestSourceCard } from "@/components/sources/TestSourceCard";
import { AddSourceForm } from "@/components/sources/AddSourceForm";
import { EditSourceModal } from "@/components/sources/EditSourceModal";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";

const Sources = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<any>(null);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [sourceToActivate, setSourceToActivate] = useState<any>(null);

  // Fetch active sources
  const { data: activeSources } = useQuery({
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
  const { data: testSources } = useQuery({
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
      const { error } = await supabase.from("sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source removed successfully");
    },
    onError: () => {
      toast.error("Failed to remove source");
    },
  });

  const handleEdit = (source: any) => {
    setSelectedSource(source);
    setEditModalOpen(true);
  };

  const handlePause = async (source: any) => {
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
    deleteMutation.mutate(sourceId);
  };

  const handleActivate = (source: any) => {
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
          {activeSources && activeSources.length > 0 ? (
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
                  onEdit={() => handleEdit(source)}
                  onPause={() => handlePause(source)}
                  onRemove={() => handleRemove(source.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No active sources yet. Add sources to the test queue and activate them after testing.
            </div>
          )}
        </TabsContent>

        <TabsContent value="test" className="space-y-4">
          {testSources && testSources.length > 0 ? (
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
                  onActivate={() => handleActivate(source)}
                  onRemove={() => handleRemove(source.id)}
                  onViewTestArtifacts={() => handleViewTestArtifacts(source.id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No sources in test queue. Add a new source below.
            </div>
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
      <AlertDialog open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate Source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will move <strong>{sourceToActivate?.name}</strong> to active sources and include
              it in all future daily runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSourceToActivate(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmActivate}>Activate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Sources;
