import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAllSources } from "@/hooks/useSources";
import { StoryCard } from "@/components/stories/StoryCard";
import { StoryDetailModal } from "@/components/stories/StoryDetailModal";
import { ArtifactsModal } from "@/components/stories/ArtifactsModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

/** Response shape from POST /api/admin/stories/:id/publish (pipeline-admin). */
interface PublishStoryResponse {
  success: boolean;
  url?: string;
  error?: string;
}

interface Story {
  id: string;
  title: string;
  content: string | null;
  status: string;
  editor_notes: string | null;
  is_test: boolean | null;
  article_type: string | null;
  prompt_version_id: string | null;
  created_at: string;
  environment: string | null;
  published_url: string | null;
  hero_image_url: string | null;
  published_at: string | null;
  source_id: string | null;
  guid: string | null;
  featured: boolean;
}

// Shape returned by GET /api/admin/artifacts — the worker nests `source` and
// `story_artifacts: [{ story: { id, title } }]` (see workers/src/routes/admin/artifacts.ts).
interface Artifact {
  id: string;
  title: string | null;
  name: string;
  date: string | null;
  guid: string | null;
  source_id: string | null;
  source: { name: string | null; type: string | null } | null;
  story_artifacts: { story: { id: string; title: string | null } }[];
}

const Stories = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [dateRangeFilter, setDateRangeFilter] = useState("30");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  // Modals
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showArtifactsModal, setShowArtifactsModal] = useState(false);
  // Fetch stories — GET /api/admin/stories returns { stories: [...] } (stories.*
  // plus a nested source from the LEFT JOIN); ordered by created_at DESC server-side.
  const { data: stories, isLoading } = useQuery({
    queryKey: ['stories'],
    queryFn: async () => {
      const { stories } = await api.get<{ stories: Story[] }>('/stories');
      return stories;
    }
  });

  // Fetch story artifact counts for all stories.
  // GET /api/admin/story-artifacts/count returns an array of { artifact_id, story_id }.
  const { data: allStoryArtifacts } = useQuery({
    queryKey: ['all-story-artifact-counts'],
    queryFn: () => api.get<{ artifact_id: string; story_id: string }[]>('/story-artifacts/count')
  });

  const storySourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    allStoryArtifacts?.forEach(sa => {
      counts.set(sa.story_id, (counts.get(sa.story_id) || 0) + 1);
    });
    return counts;
  }, [allStoryArtifacts]);

  // Fetch sources for filter dropdown — GET /api/admin/sources (array of source rows).
  const { data: sources } = useAllSources();

  // Fetch story artifacts — there is no documented artifacts-by-story endpoint, so
  // we use GET /api/admin/artifacts (each artifact carries a nested `source` and its
  // `story_artifacts: [{ story: { id } }]`) and keep only those linked to this story.
  const { data: storyArtifacts } = useQuery({
    queryKey: ['story-artifacts', selectedStory?.id],
    enabled: !!selectedStory?.id && showArtifactsModal,
    queryFn: async () => {
      const { artifacts } = await api.get<{ artifacts: Artifact[] }>('/artifacts');
      return artifacts
        .filter(a => a.story_artifacts?.some(sa => sa.story?.id === selectedStory!.id))
        .map(a => ({
          id: a.id,
          title: a.title,
          name: a.name,
          date: a.date,
          guid: a.guid,
          source_id: a.source_id,
          source_name: a.source?.name ?? undefined,
        }));
    }
  });

  // Filter stories
  const filteredStories = useMemo(() => {
    if (!stories) return [];
    
    let filtered = stories;
    
    if (statusFilter !== "all") {
      filtered = filtered.filter(s => s.status === statusFilter);
    }
    
    if (environmentFilter !== "all") {
      filtered = filtered.filter(s => s.environment === environmentFilter);
    }
    
    if (typeFilter !== "all") {
      filtered = filtered.filter(s => s.article_type === typeFilter);
    }
    
    if (sourceFilter !== "all") {
      filtered = filtered.filter(s => s.source_id === sourceFilter);
    }
    
    if (dateRangeFilter !== "all") {
      const days = parseInt(dateRangeFilter);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      filtered = filtered.filter(s => new Date(s.created_at) >= cutoffDate);
    }
    
    return filtered;
  }, [stories, statusFilter, environmentFilter, typeFilter, sourceFilter, dateRangeFilter]);

  // Update story mutation (content save + reject).
  // NOTE: no story-update endpoint is documented in ADMIN_API_SPEC.md / the stories
  // router (which only exposes GET list, GET :id, DELETE :id, and POST :id/publish).
  // Routed to the natural REST endpoint PATCH /api/admin/stories/:id; this worker
  // route still needs to be added on the backend.
  const updateStoryMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Record<string, unknown> }) =>
      api.patch(`/stories/${id}`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      toast({ title: "Success", description: "Story updated successfully" });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Delete story mutation — DELETE /api/admin/stories/:id (cascades junction rows).
  const deleteStoryMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/stories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      toast({ title: "Success", description: "Story deleted successfully" });
      setShowDetailModal(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleView = (story: Story) => {
    setSelectedStory(story);
    setShowDetailModal(true);
  };

  const handleSaveContent = (content: string) => {
    if (!selectedStory) return;
    updateStoryMutation.mutate({
      id: selectedStory.id,
      updates: { content }
    });
  };

  const handlePublish = async (story?: Story) => {
    const storyToPublish = story || selectedStory;
    if (!storyToPublish) return;

    try {
      toast({
        title: "Publishing",
        description: "Please wait..."
      });

      const result = await api.post<PublishStoryResponse>(
        `/stories/${storyToPublish.id}/publish`,
        { featured: storyToPublish.featured || false }
      );

      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['stories'] });

        toast({
          title: storyToPublish.published_url ? "Updated!" : "Published!",
          description: result.url ? (
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              View on site &rarr;
            </a>
          ) : "Story published successfully"
        });

        setShowDetailModal(false);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : "Failed to publish";
      toast({
        title: "Publishing Failed",
        description: errorMsg,
        variant: "destructive"
      });
    }
  };

  const handleReject = (story?: Story) => {
    const storyToReject = story || selectedStory;
    if (!storyToReject) return;
    updateStoryMutation.mutate({
      id: storyToReject.id,
      updates: { status: 'rejected' }
    });
  };

  const handleDelete = (story?: Story) => {
    const storyToDelete = story || selectedStory;
    if (!storyToDelete) return;
    
    if (confirm('Are you sure you want to delete this story?')) {
      deleteStoryMutation.mutate(storyToDelete.id);
    }
  };

  const handleViewArtifacts = () => {
    setShowArtifactsModal(true);
  };

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Stories</h1>
          <p className="text-muted-foreground mt-1">
            Showing {filteredStories.length} of {stories?.length || 0} stories
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-card border rounded-lg p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="fact_checked">Fact Checked</SelectItem>
                <SelectItem value="edited">Edited</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
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
                <SelectItem value="all">All</SelectItem>
                {sources?.map(source => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Type</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="brief">Brief</SelectItem>
                <SelectItem value="full">Full Article</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Story List */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : filteredStories.length === 0 ? (
        <div className="text-center py-12 bg-card border rounded-lg">
          <p className="text-muted-foreground">No stories found matching your filters</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredStories.map(story => (
            <StoryCard
              key={story.id}
              story={{ ...story, is_test: story.is_test ?? false, article_type: story.article_type ?? '', environment: story.environment ?? '' }}
              sourceCount={storySourceCounts.get(story.id) || 0}
              onView={() => handleView(story)}
              onEdit={() => handleView(story)}
              onPublish={() => handlePublish(story)}
              onReject={() => handleReject(story)}
              onDelete={() => handleDelete(story)}
            />
          ))}
        </div>
      )}

      {/* Story Detail Modal */}
      <StoryDetailModal
        story={selectedStory ? { ...selectedStory, is_test: selectedStory.is_test ?? false, article_type: selectedStory.article_type ?? '', environment: selectedStory.environment ?? '', guid: selectedStory.guid ?? '' } : null}
        open={showDetailModal}
        onClose={() => setShowDetailModal(false)}
        onSave={handleSaveContent}
        onPublish={() => handlePublish()}
        onDelete={() => handleDelete()}
        onReject={handleReject}
        onViewArtifacts={handleViewArtifacts}
      />

      {/* Artifacts Modal */}
      <ArtifactsModal
        artifacts={(storyArtifacts || []).map(a => ({ id: a.id, title: a.title, name: a.name, date: a.date ?? '', guid: a.guid ?? '', source_name: a.source_name }))}
        open={showArtifactsModal}
        onClose={() => setShowArtifactsModal(false)}
      />
    </div>
  );
};

export default Stories;
