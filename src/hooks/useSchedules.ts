import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type ScheduleType = "artifact_fetch" | "ai_journalism" | "sms_notification";

export interface Schedule {
  id: string;
  schedule_type: ScheduleType;
  scheduled_times: string[];
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const useSchedule = (scheduleType: ScheduleType) => {
  return useQuery({
    queryKey: ["schedule", scheduleType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select("*")
        .eq("schedule_type", scheduleType)
        .maybeSingle();

      if (error) throw error;
      return data as Schedule | null;
    },
  });
};

export const useSaveSchedule = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      scheduleType,
      scheduledTimes,
      isEnabled,
    }: {
      scheduleType: ScheduleType;
      scheduledTimes: string[];
      isEnabled: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke("manage-schedule", {
        body: {
          scheduleType,
          scheduledTimes,
          isEnabled,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["schedule", variables.scheduleType] });
      toast.success("Schedule saved successfully");
    },
    onError: (error: Error) => {
      console.error("Error saving schedule:", error);
      toast.error(`Failed to save schedule: ${error.message}`);
    },
  });
};
