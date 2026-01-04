import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SMS_SETTINGS_KEY = "sms_notification_settings";

interface SmsSettings {
  message_template: string;
}

export const useSmsSettings = () => {
  return useQuery({
    queryKey: ["sms-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SMS_SETTINGS_KEY)
        .maybeSingle();

      if (error) throw error;
      if (!data?.value) return null;
      const value = data.value as unknown as SmsSettings;
      return value;
    },
  });
};

export const useSaveSmsSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageTemplate }: { messageTemplate: string }) => {
      const { data, error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: SMS_SETTINGS_KEY,
            value: { message_template: messageTemplate },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sms-settings"] });
      toast.success("SMS settings saved");
    },
    onError: (error: Error) => {
      console.error("Error saving SMS settings:", error);
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });
};
