import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface ArtifactsFilters {
  environment?: "production" | "test" | "all";
  sourceId?: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  usageStatus?: "all" | "used" | "unused";
}

// Shape returned by GET /api/admin/artifacts and /api/admin/artifacts/:id —
// the worker reshapes the flat join into the nested source/story_artifacts
// objects the SPA components expect (see workers/src/routes/admin/artifacts.ts).
interface Artifact {
  id: string;
  source: { name: string | null; type: string | null } | null;
  story_artifacts: { story: { id: string; title: string | null } }[];
  [key: string]: unknown;
}

export const useArtifacts = (filters?: ArtifactsFilters) => {
  return useQuery({
    queryKey: ["artifacts", filters],
    queryFn: async () => {
      // Filtering (sourceId, dateFrom, dateTo, searchQuery, usageStatus) is
      // applied server-side; pass them as query params.
      const { artifacts } = await api.get<{ artifacts: Artifact[] }>("/artifacts", {
        sourceId: filters?.sourceId,
        dateFrom: filters?.dateFrom,
        dateTo: filters?.dateTo,
        searchQuery: filters?.searchQuery,
        usageStatus: filters?.usageStatus,
      });
      return artifacts;
    },
  });
};

export const useArtifact = (artifactId: string) => {
  return useQuery({
    queryKey: ["artifacts", artifactId],
    queryFn: async () => {
      const { artifact } = await api.get<{ artifact: Artifact }>(`/artifacts/${artifactId}`);
      return artifact;
    },
    enabled: !!artifactId,
  });
};
