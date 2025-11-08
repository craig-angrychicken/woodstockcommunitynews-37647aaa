import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface QueryHistoryFilters {
  environment?: "production" | "test" | "all";
  status?: "running" | "completed" | "failed";
  dateFrom?: string;
  dateTo?: string;
}

export const useQueryHistory = (filters?: QueryHistoryFilters) => {
  return useQuery({
    queryKey: ["query-history", filters],
    queryFn: async () => {
      let query = supabase
        .from("query_history")
        .select(`
          *,
          prompt_version:prompt_versions(version_name, prompt_type)
        `)
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters?.environment && filters.environment !== "all") {
        query = query.eq("environment", filters.environment);
      }

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      if (filters?.dateFrom) {
        query = query.gte("created_at", filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte("created_at", filters.dateTo);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
  });
};

export const useQueryRun = (queryId: string) => {
  return useQuery({
    queryKey: ["query-history", queryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("query_history")
        .select(`
          *,
          prompt_version:prompt_versions(version_name, prompt_type, content)
        `)
        .eq("id", queryId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!queryId,
  });
};

export const useRecentQueryHistory = (limit: number = 10) => {
  return useQuery({
    queryKey: ["query-history", "recent", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("query_history")
        .select(`
          *,
          prompt_version:prompt_versions(version_name, prompt_type)
        `)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    },
  });
};
