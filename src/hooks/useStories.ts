import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface StoriesFilters {
  environment?: "production" | "test" | "all";
  status?: string;
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
}

/**
 * A story row as returned by GET /api/admin/stories. Mirrors the worker's
 * shapeStory output: stories.* plus a nested `source` ({ name, type } | null)
 * built from the LEFT JOIN. JSON TEXT columns (structured_metadata,
 * generation_metadata) are decoded server-side.
 */
type Story = Record<string, unknown> & {
  id: string;
  source: { name: string | null; type: string | null } | null;
};

export const useStories = (filters?: StoriesFilters) => {
  return useQuery({
    queryKey: ["stories", filters],
    queryFn: async () => {
      // Filters are forwarded as query params; the worker applies them
      // server-side (environment skipped when "all", searchQuery as a
      // case-insensitive LIKE on title/content/source name).
      const { stories } = await api.get<{ stories: Story[] }>("/stories", {
        environment: filters?.environment,
        status: filters?.status,
        sourceId: filters?.sourceId,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        searchQuery: filters?.searchQuery,
      });
      return stories;
    },
  });
};

export const useStory = (storyId: string) => {
  return useQuery({
    queryKey: ["stories", storyId],
    queryFn: async () => {
      const { story } = await api.get<{ story: Story }>(`/stories/${storyId}`);
      return story;
    },
    enabled: !!storyId,
  });
};
