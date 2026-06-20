import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";

export type ScheduleType = "artifact_fetch" | "ai_journalism" | "ai_editor";

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
      // GET /api/admin/schedules/:type — returns the schedule object or null.
      return api.get<Schedule | null>(`/schedules/${scheduleType}`);
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
      // Routes through the admin API: POST /api/admin/manage-schedule.
      return api.post("/manage-schedule", {
        scheduleType,
        scheduledTimes,
        isEnabled,
      });
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
