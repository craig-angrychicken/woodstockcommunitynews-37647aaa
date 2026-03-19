import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      const { data, error } = await supabase
        .from("journalism_queue")
        .select(`
          error_message,
          completed_at,
          artifact:artifacts(title, url)
        `)
        .eq("status", "skipped")
        .gte("completed_at", cutoff)
        .order("completed_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        title: row.artifact?.title || null,
        skip_reason: row.error_message,
        url: row.artifact?.url || null,
        completed_at: row.completed_at,
      })) as SkippedArtifact[];
    },
  });
};

export const useRejectedStories = (days = 7) => {
  return useQuery({
    queryKey: ["rejected-stories", days],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      const { data, error } = await supabase
        .from("stories")
        .select("title, editor_notes, updated_at")
        .eq("status", "rejected")
        .eq("is_test", false)
        .eq("environment", "production")
        .gte("updated_at", cutoff)
        .order("updated_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        title: row.title,
        rejection_reason: row.editor_notes,
        updated_at: row.updated_at,
      })) as RejectedStory[];
    },
  });
};

export const useSkipRejectCounts = () => {
  return useQuery({
    queryKey: ["skip-reject-counts"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 86400000).toISOString();

      const [skippedRes, rejectedRes] = await Promise.all([
        supabase
          .from("journalism_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "skipped")
          .gte("completed_at", cutoff),
        supabase
          .from("stories")
          .select("id", { count: "exact", head: true })
          .eq("status", "rejected")
          .eq("is_test", false)
          .eq("environment", "production")
          .gte("updated_at", cutoff),
      ]);

      if (skippedRes.error) throw skippedRes.error;
      if (rejectedRes.error) throw rejectedRes.error;

      return {
        skippedCount: skippedRes.count || 0,
        rejectedCount: rejectedRes.count || 0,
      };
    },
    refetchInterval: 60000,
  });
};
