import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArtifactCard } from "@/components/artifacts/ArtifactCard";
import { ArtifactDetailModal } from "@/components/artifacts/ArtifactDetailModal";
import { CardSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { BulkDeleteDialog } from "@/components/ui/bulk-delete-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Search, FileText, Trash2 } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const Artifacts = () => {
  const queryClient = useQueryClient();

  // Filters
  const [dateRangeFilter, setDateRangeFilter] = useState("30");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [usageFilter, setUsageFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [selectedArtifact, setSelectedArtifact] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [artifactToDelete, setArtifactToDelete] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());

  // Fetch artifacts
  const {
    data: artifacts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['artifacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artifacts')
        .select(`
          *,
          sources (name)
        `)
        .order('date', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  // Fetch sources for filter
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: async () => {
      const { data, error } = await supabase.from('sources').select('id, name');
      if (error) throw error;
      return data;
    }
  });

  // Fetch story artifacts to determine usage
  const { data: storyArtifacts } = useQuery({
    queryKey: ['all-story-artifacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('story_artifacts')
        .select('artifact_id, story_id, stories(id, title)');
      if (error) throw error;
      return data;
    }
  });

  // Fetch stories using selected artifact
  const { data: artifactStories } = useQuery({
    queryKey: ['artifact-stories', selectedArtifact?.id],
    enabled: !!selectedArtifact?.id && showDetailModal,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('story_artifacts')
        .select('stories(id, title)')
        .eq('artifact_id', selectedArtifact.id);

      if (error) throw error;
      return data.map(sa => sa.stories).filter(Boolean);
    }
  });

  // Delete artifact mutation
  const deleteArtifactMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('artifacts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['all-story-artifacts'] });
      toast.success("Artifact deleted successfully");
      setShowDetailModal(false);
      setDeleteDialogOpen(false);
      setArtifactToDelete(null);
    },
    onError: (error: any) => {
      toast.error(`Failed to delete artifact: ${error.message}`);
    }
  });

  const handleDelete = (artifactId: string) => {
    setArtifactToDelete(artifactId);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (artifactToDelete) {
      deleteArtifactMutation.mutate(artifactToDelete);
    }
  };

  // Bulk delete for test artifacts
  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      const testArtifactIds = filteredArtifacts
        .filter(a => environmentFilter === "test" || a.is_test)
        .map(a => a.id);
      
      if (testArtifactIds.length === 0) {
        throw new Error("No test artifacts to delete");
      }

      const { error } = await supabase
        .from('artifacts')
        .delete()
        .in('id', testArtifactIds);

      if (error) throw error;
      return testArtifactIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['artifacts'] });
      queryClient.invalidateQueries({ queryKey: ['all-story-artifacts'] });
      toast.success(`Successfully deleted ${count} test artifacts`);
      setBulkDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast.error(`Failed to bulk delete: ${error.message}`);
    }
  });

  const handleBulkDelete = () => {
    setBulkDeleteDialogOpen(true);
  };

  // Get usage count for each artifact
  const artifactUsage = useMemo(() => {
    const usage = new Map<string, number>();
    storyArtifacts?.forEach(sa => {
      usage.set(sa.artifact_id, (usage.get(sa.artifact_id) || 0) + 1);
    });
    return usage;
  }, [storyArtifacts]);

  // Filter artifacts
  const filteredArtifacts = useMemo(() => {
    if (!artifacts) return [];

    let filtered = artifacts;

    // Date range filter
    if (dateRangeFilter !== "all") {
      const days = parseInt(dateRangeFilter);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      filtered = filtered.filter(a => new Date(a.date) >= cutoffDate);
    }

    // Source filter
    if (sourceFilter !== "all") {
      filtered = filtered.filter(a => a.source_id === sourceFilter);
    }

    // Environment filter (based on is_test in related stories)
    if (environmentFilter !== "all") {
      const isTestFilter = environmentFilter === "test";
      // For now, we'll need to check if any story using this artifact is test
      // This is a simplified version - you might want to add is_test to artifacts table
      filtered = filtered;
    }

    // Usage filter
    if (usageFilter !== "all") {
      if (usageFilter === "unused") {
        filtered = filtered.filter(a => !artifactUsage.has(a.id));
      } else if (usageFilter === "used") {
        filtered = filtered.filter(a => artifactUsage.has(a.id));
      }
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        (a.title?.toLowerCase().includes(query)) ||
        a.name.toLowerCase().includes(query) ||
        (a.content?.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [artifacts, dateRangeFilter, sourceFilter, environmentFilter, usageFilter, searchQuery, artifactUsage]);

  // Calculate test artifacts count after filteredArtifacts is defined
  const testArtifactsCount = filteredArtifacts.filter(a => 
    environmentFilter === "test" || a.is_test
  ).length;

  // Group artifacts by source
  const groupedArtifacts = useMemo(() => {
    const groups = new Map<string, typeof filteredArtifacts>();

    filteredArtifacts.forEach(artifact => {
      const sourceName = artifact.sources?.name || 'Unknown Source';
      if (!groups.has(sourceName)) {
        groups.set(sourceName, []);
      }
      groups.get(sourceName)!.push(artifact);
    });

    return Array.from(groups.entries()).map(([sourceName, artifacts]) => ({
      sourceName,
      artifacts,
      count: artifacts.length
    }));
  }, [filteredArtifacts]);

  const toggleSource = (sourceName: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceName)) {
        next.delete(sourceName);
      } else {
        next.add(sourceName);
      }
      return next;
    });
  };

  const handleViewContent = (artifact: any) => {
    setSelectedArtifact(artifact);
    setShowDetailModal(true);
  };

  const handleViewStory = (artifactId: string) => {
    // Navigate to stories page filtered by this artifact
    window.location.href = `/stories?artifact=${artifactId}`;
  };


  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Artifacts</h1>
          <p className="text-muted-foreground mt-1">
            Showing {filteredArtifacts.length} of {artifacts?.length || 0} artifacts
          </p>
        </div>
        {environmentFilter === "test" && testArtifactsCount > 0 && (
          <Button
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={bulkDeleteMutation.isPending}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete All Test Data ({testArtifactsCount})
          </Button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-card border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Date Range</label>
            <Select value={dateRangeFilter} onValueChange={setDateRangeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Source</label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources?.map(source => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Environment</label>
            <Select value={environmentFilter} onValueChange={setEnvironmentFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="production">Production</SelectItem>
                <SelectItem value="test">Test</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Show</label>
            <Select value={usageFilter} onValueChange={setUsageFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="unused">Unused</SelectItem>
                <SelectItem value="used">Used in Stories</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search artifacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Grouped Artifacts Display */}
      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : error ? (
        <ErrorState
          message="Failed to load artifacts. Please try again."
          onRetry={() => refetch()}
        />
      ) : groupedArtifacts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No artifacts found"
          description="No artifacts match your current filters. Try adjusting your filter criteria or add new sources to start collecting content."
        />
      ) : (
        <div className="space-y-4">
          {groupedArtifacts.map(({ sourceName, artifacts, count }) => (
            <Collapsible
              key={sourceName}
              open={expandedSources.has(sourceName)}
              onOpenChange={() => toggleSource(sourceName)}
            >
              <div className="border rounded-lg">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      {expandedSources.has(sourceName) ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                      <span className="text-lg font-semibold">{sourceName}</span>
                      <span className="text-sm text-muted-foreground">
                        ({count} {count === 1 ? 'artifact' : 'artifacts'})
                      </span>
                    </div>
                  </Button>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="p-4 pt-0">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {artifacts.map(artifact => (
                        <ArtifactCard
                          key={artifact.id}
                          artifact={artifact}
                          sourceName={sourceName}
                          isTest={false} // TODO: Determine from related stories
                          storiesCount={artifactUsage.get(artifact.id) || 0}
                          onViewContent={() => handleViewContent(artifact)}
                          onViewStory={() => handleViewStory(artifact.id)}
                          onDelete={() => handleDelete(artifact.id)}
                        />
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ))}
        </div>
      )}

      {/* Artifact Detail Modal */}
      <ArtifactDetailModal
        artifact={selectedArtifact}
        sourceName={selectedArtifact?.sources?.name || 'Unknown'}
        isTest={false} // TODO: Determine from related stories
        stories={artifactStories || []}
        open={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        onDelete={() => handleDelete(selectedArtifact?.id)}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Artifact?"
        description="This will permanently remove this artifact. This action cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
      />

      {/* Bulk Delete Dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        title="Delete All Test Artifacts?"
        description="This will permanently delete all test artifacts currently shown in your filtered view."
        itemCount={testArtifactsCount}
        onConfirm={async () => {
          await bulkDeleteMutation.mutateAsync();
        }}
      />
    </div>
  );
};

export default Artifacts;
