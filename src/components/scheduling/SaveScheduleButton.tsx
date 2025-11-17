import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useSaveSchedule, type ScheduleType } from "@/hooks/useSchedules";

interface SaveScheduleButtonProps {
  scheduleType: ScheduleType;
  times: string[];
  enabled: boolean;
}

export function SaveScheduleButton({ scheduleType, times, enabled }: SaveScheduleButtonProps) {
  const saveSchedule = useSaveSchedule();

  const handleSave = () => {
    saveSchedule.mutate({
      scheduleType,
      scheduledTimes: times,
      isEnabled: enabled,
    });
  };

  return (
    <Button
      onClick={handleSave}
      disabled={saveSchedule.isPending}
      className="w-full"
    >
      {saveSchedule.isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Saving...
        </>
      ) : (
        "Save Schedule"
      )}
    </Button>
  );
}
