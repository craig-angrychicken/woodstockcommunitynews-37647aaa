import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Tables } from "@/integrations/supabase/types";

type QueryHistory = Tables<"query_history">;

interface QueryHistoryFilters {
  environment?: "production" | "test" | "all";
  status?: "running" | "completed" | "failed";
  dateFrom?: string;
  dateTo?: string;
}

export const useQueryHistory = (filters?: QueryHistoryFilters) => {
  return useQuery({
    queryKey: ["query-history", filters],
    queryFn: () =>
      api.get<QueryHistory[]>("/query-history", {
        environment: filters?.environment,
        status: filters?.status,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
      }),
  });
};

export const useQueryRun = (queryId: string) => {
  return useQuery({
    queryKey: ["query-history", queryId],
    queryFn: () => api.get<QueryHistory>(`/query-history/${queryId}`),
    enabled: !!queryId,
  });
};

export const useRecentQueryHistory = (limit: number = 10) => {
  return useQuery({
    queryKey: ["query-history", "recent", limit],
    queryFn: () => api.get<QueryHistory[]>("/query-history/recent", { limit }),
  });
};
