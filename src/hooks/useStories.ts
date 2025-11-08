import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface StoriesFilters {
  environment?: "production" | "test" | "all";
  status?: string;
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
}

export const useStories = (filters?: StoriesFilters) => {
  return useQuery({
    queryKey: ["stories", filters],
    queryFn: async () => {
      let query = supabase
        .from("stories")
        .select(`
          *,
          source:sources(name, type),
          story_artifacts(
            artifact:artifacts(*)
          )
        `)
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters?.environment && filters.environment !== "all") {
        query = query.eq("environment", filters.environment);
      }

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      if (filters?.sourceId) {
        query = query.eq("source_id", filters.sourceId);
      }

      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo);
      }

      if (filters?.searchQuery) {
        query = query.or(
          `title.ilike.%${filters.searchQuery}%,content.ilike.%${filters.searchQuery}%`
        );
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
  });
};

export const useStory = (storyId: string) => {
  return useQuery({
    queryKey: ["stories", storyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stories")
        .select(`
          *,
          source:sources(name, type),
          story_artifacts(
            artifact:artifacts(*)
          )
        `)
        .eq("id", storyId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!storyId,
  });
};
