import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useActivePrompts = () => {
  return useQuery({
    queryKey: ["prompts", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_active", true)
        .eq("is_test_draft", false)
        .order("prompt_type");

      if (error) throw error;
      return data;
    },
  });
};

export const useTestDrafts = () => {
  return useQuery({
    queryKey: ["prompts", "test-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_test_draft", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
};

export const usePromptHistory = () => {
  return useQuery({
    queryKey: ["prompts", "history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("is_test_draft", false)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
};

export const usePromptVersion = (promptId: string) => {
  return useQuery({
    queryKey: ["prompts", promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("id", promptId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!promptId,
  });
};

export const usePromptsByType = (promptType: "retrieval" | "journalism") => {
  return useQuery({
    queryKey: ["prompts", "type", promptType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prompt_versions")
        .select("*")
        .eq("prompt_type", promptType)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
};
