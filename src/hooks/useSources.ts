import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useActiveSources = () => {
  return useQuery({
    queryKey: ["sources", "active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("status", "active")
        .order("name");

      if (error) throw error;
      return data;
    },
  });
};

export const useTestSources = () => {
  return useQuery({
    queryKey: ["sources", "testing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("status", "testing")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });
};

export const useAllSources = () => {
  return useQuery({
    queryKey: ["sources", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .order("name");

      if (error) throw error;
      return data;
    },
  });
};

export const useSource = (sourceId: string) => {
  return useQuery({
    queryKey: ["sources", sourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("id", sourceId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!sourceId,
  });
};

export const useSourcesByType = (type: string) => {
  return useQuery({
    queryKey: ["sources", "type", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .eq("type", type)
        .order("name");

      if (error) throw error;
      return data;
    },
  });
};
