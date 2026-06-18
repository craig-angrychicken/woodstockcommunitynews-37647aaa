import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface SkippedArtifact {
  title: string | null;
  skip_reason: string | null;
  url: string | null;
  completed_at: string;
}

export interface RejectedStory {
  title: string;
  rejection_reason: string | null;
  updated_at: string;
}

export const useSkippedArtifacts = (days = 7) => {
  return useQuery({
    queryKey: ["skipped-artifacts", days],
    queryFn: async () => {
      return await api.get<SkippedArtifact[]>("/skipped-artifacts", { days });
    },
  });
};

export const useRejectedStories = (days = 7) => {
  return useQuery({
    queryKey: ["rejected-stories", days],
    queryFn: async () => {
      return await api.get<RejectedStory[]>("/rejected-stories", { days });
    },
  });
};

export const useSkipRejectCounts = () => {
  return useQuery({
    queryKey: ["skip-reject-counts"],
    queryFn: async () => {
      return await api.get<{ skippedCount: number; rejectedCount: number }>(
        "/skip-reject-counts",
      );
    },
    refetchInterval: 60000,
  });
};
