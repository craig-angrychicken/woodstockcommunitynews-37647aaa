import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScheduleTimeSelector } from "@/components/scheduling/ScheduleTimeSelector";
import { useSchedule, useSaveSchedule } from "@/hooks/useSchedules";
import { useSmsSettings, useSaveSmsSettings } from "@/hooks/useSmsSettings";
import { Clock, MessageSquareText, Save, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const SMS_PRESETS = [
  { label: "9:30 AM", time: "09:30" },
  { label: "12:00 PM", time: "12:00" },
  { label: "5:30 PM", time: "17:30" },
  { label: "8:00 PM", time: "20:00" },
];

export function SmsSettingsCard() {
  const { data: schedule, isLoading: scheduleLoading } = useSchedule("sms_notification");
  const { data: smsSettings, isLoading: settingsLoading } = useSmsSettings();
  const saveSchedule = useSaveSchedule();
  const saveSmsSettings = useSaveSmsSettings();

  const [scheduledTimes, setScheduledTimes] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState(
    "Check woodstockcommunity.news - there have been {{count}} {{stories}} published since the last notification"
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from fetched data
  useEffect(() => {
    if (schedule) {
      setScheduledTimes(schedule.scheduled_times || []);
      setIsEnabled(schedule.is_enabled);
    }
  }, [schedule]);

  useEffect(() => {
    if (smsSettings?.message_template) {
      setMessageTemplate(smsSettings.message_template);
    }
  }, [smsSettings]);

  // Track changes
  useEffect(() => {
    const scheduleChanged = schedule && (
      JSON.stringify(scheduledTimes) !== JSON.stringify(schedule.scheduled_times || []) ||
      isEnabled !== schedule.is_enabled
    );
    const templateChanged = smsSettings?.message_template 
      ? messageTemplate !== smsSettings.message_template
      : messageTemplate !== "Check woodstockcommunity.news - there have been {{count}} {{stories}} published since the last notification";
    
    setHasChanges(Boolean(scheduleChanged || templateChanged));
  }, [scheduledTimes, isEnabled, messageTemplate, schedule, smsSettings]);

  const handleSave = async () => {
    try {
      await Promise.all([
        saveSchedule.mutateAsync({
          scheduleType: "sms_notification",
          scheduledTimes,
          isEnabled,
        }),
        saveSmsSettings.mutateAsync({ messageTemplate }),
      ]);
      setHasChanges(false);
    } catch (error) {
      // Error handled by mutations
    }
  };

  const isLoading = scheduleLoading || settingsLoading;
  const isSaving = saveSchedule.isPending || saveSmsSettings.isPending;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-6">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              SMS Schedule & Message
            </CardTitle>
            <CardDescription>
              Configure when notifications are sent and customize the message
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="sms-enabled"
                checked={isEnabled}
                onCheckedChange={setIsEnabled}
              />
              <Label htmlFor="sms-enabled" className="text-sm">
                {isEnabled ? "Enabled" : "Disabled"}
              </Label>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Message Template */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-muted-foreground" />
            <Label className="text-base font-semibold">Message Template</Label>
          </div>
          <Textarea
            value={messageTemplate}
            onChange={(e) => setMessageTemplate(e.target.value)}
            placeholder="Enter your SMS message template..."
            className="min-h-[100px] resize-none"
          />
          <p className="text-xs text-muted-foreground">
            Use <code className="bg-muted px-1 py-0.5 rounded">{"{{count}}"}</code> for the number of stories and{" "}
            <code className="bg-muted px-1 py-0.5 rounded">{"{{stories}}"}</code> for "story" or "stories"
          </p>
        </div>

        {/* Schedule Times */}
        <ScheduleTimeSelector
          scheduledTimes={scheduledTimes}
          onChange={setScheduledTimes}
          label="Notification Times"
          description="Select the times when SMS notifications will be sent daily"
          presets={SMS_PRESETS}
        />

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
