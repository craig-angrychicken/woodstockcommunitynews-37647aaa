import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Tables } from "@/integrations/supabase/types";

type PromptVersion = Tables<"prompt_versions">;

export const useActivePrompts = () => {
  return useQuery({
    queryKey: ["prompts", "active"],
    queryFn: () =>
      api.get<PromptVersion[]>("/prompt-versions", {
        activeOnly: true,
        excludeTestDrafts: true,
      }),
  });
};

export const useTestDrafts = () => {
  return useQuery({
    queryKey: ["prompts", "test-drafts"],
    queryFn: () =>
      api.get<PromptVersion[]>("/prompt-versions/drafts", {
        testDraftsOnly: true,
      }),
  });
};

export const usePromptHistory = () => {
  return useQuery({
    queryKey: ["prompts", "history"],
    queryFn: () => api.get<PromptVersion[]>("/prompt-versions/history"),
  });
};

export const usePromptVersion = (promptId: string) => {
  return useQuery({
    queryKey: ["prompts", promptId],
    queryFn: () => api.get<PromptVersion>(`/prompt-versions/${promptId}`),
    enabled: !!promptId,
  });
};
