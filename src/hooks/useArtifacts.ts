import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ArtifactsFilters {
  environment?: "production" | "test" | "all";
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  usageStatus?: "all" | "used" | "unused";
}

export const useArtifacts = (filters?: ArtifactsFilters) => {
  return useQuery({
    queryKey: ["artifacts", filters],
    queryFn: async () => {
      let query = supabase
        .from("artifacts")
        .select(`
          *,
          source:sources(name, type),
          story_artifacts(
            story:stories(id, title)
          )
        `)
        .order("date", { ascending: false });

      // Apply filters
      if (filters?.sourceId) {
        query = query.eq("source_id", filters.sourceId);
      }

      if (filters?.dateFrom) {
        query = query.gte("date", filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte("date", filters.dateTo);
      }

      if (filters?.searchQuery) {
        query = query.or(
          `title.ilike.%${filters.searchQuery}%,content.ilike.%${filters.searchQuery}%,name.ilike.%${filters.searchQuery}%`
        );
      }

      const { data, error } = await query;

      if (error) throw error;

      // Filter by usage status
      if (filters?.usageStatus === "used") {
        return data?.filter((artifact) => artifact.story_artifacts?.length > 0);
      } else if (filters?.usageStatus === "unused") {
        return data?.filter((artifact) => !artifact.story_artifacts?.length);
      }

      return data;
    },
  });
};

export const useArtifact = (artifactId: string) => {
  return useQuery({
    queryKey: ["artifacts", artifactId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artifacts")
        .select(`
          *,
          source:sources(name, type),
          story_artifacts(
            story:stories(id, title)
          )
        `)
        .eq("id", artifactId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!artifactId,
  });
};
