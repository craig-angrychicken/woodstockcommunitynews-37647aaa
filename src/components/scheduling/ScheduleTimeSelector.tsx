import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatTime24To12Hour, sortTimes, validateTime } from "@/lib/time-utils";
import { toast } from "sonner";

interface ScheduleTimeSelectorProps {
  scheduledTimes: string[];
  onChange: (times: string[]) => void;
  label: string;
  description?: string;
  presets?: Array<{ label: string; time: string }>;
}

export function ScheduleTimeSelector({
  scheduledTimes,
  onChange,
  label,
  description,
  presets = []
}: ScheduleTimeSelectorProps) {
  const [newTime, setNewTime] = useState("06:00");

  const handleAddTime = () => {
    if (!validateTime(newTime)) {
      toast.error("Invalid time format");
      return;
    }

    if (scheduledTimes.includes(newTime)) {
      toast.error("This time is already scheduled");
      return;
    }

    const updatedTimes = sortTimes([...scheduledTimes, newTime]);
    onChange(updatedTimes);
    toast.success("Time added to schedule");
  };

  const handleRemoveTime = (timeToRemove: string) => {
    const updatedTimes = scheduledTimes.filter(t => t !== timeToRemove);
    onChange(updatedTimes);
    toast.success("Time removed from schedule");
  };

  const handlePresetClick = (time: string) => {
    if (scheduledTimes.includes(time)) {
      toast.error("This time is already scheduled");
      return;
    }

    const updatedTimes = sortTimes([...scheduledTimes, time]);
    onChange(updatedTimes);
    toast.success("Preset time added");
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-base font-semibold">{label}</Label>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1 italic">All times are in Eastern Time (ET)</p>
      </div>

      {scheduledTimes.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-sm">Current Schedule</Label>
          <div className="flex flex-wrap gap-2">
            {scheduledTimes.map((time) => (
              <Badge key={time} variant="secondary" className="text-base py-2 px-3">
                {formatTime24To12Hour(time)}
                <button
                  onClick={() => handleRemoveTime(time)}
                  className="ml-2 hover:text-destructive transition-colors"
                  aria-label={`Remove ${formatTime24To12Hour(time)}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">No times scheduled yet</p>
      )}

      <div className="space-y-2">
        <Label htmlFor={`time-input-${label}`}>Add Time</Label>
        <div className="flex gap-2">
          <Input
            id={`time-input-${label}`}
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            className="max-w-[150px]"
          />
          <Button onClick={handleAddTime} variant="outline">
            Add Time
          </Button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="space-y-2">
          <Label className="text-sm">Quick Presets</Label>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.time}
                variant="outline"
                size="sm"
                onClick={() => handlePresetClick(preset.time)}
                disabled={scheduledTimes.includes(preset.time)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
