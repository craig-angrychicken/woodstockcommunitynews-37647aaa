import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Tables } from "@/types/tables";

type Source = Tables<"sources">;

export const useActiveSources = () => {
  return useQuery({
    queryKey: ["sources", "active"],
    queryFn: () => api.get<Source[]>("/sources", { status: "active" }),
  });
};

export const useTestSources = () => {
  return useQuery({
    queryKey: ["sources", "testing"],
    queryFn: () => api.get<Source[]>("/sources", { status: "testing" }),
  });
};

export const useAllSources = () => {
  return useQuery({
    queryKey: ["sources", "all"],
    queryFn: () => api.get<Source[]>("/sources", { status: "all" }),
  });
};

export const useSource = (sourceId: string) => {
  return useQuery({
    queryKey: ["sources", sourceId],
    queryFn: () => api.get<Source>(`/sources/${sourceId}`),
    enabled: !!sourceId,
  });
};

export const useSourcesByType = (type: string) => {
  return useQuery({
    queryKey: ["sources", "type", type],
    queryFn: () => api.get<Source[]>(`/sources/type/${type}`),
  });
};
