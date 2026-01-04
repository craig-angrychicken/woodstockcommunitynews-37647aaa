import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";

type NotificationRecipient = Tables<"notification_recipients">;

export const useNotificationRecipients = () => {
  const queryClient = useQueryClient();

  const recipientsQuery = useQuery({
    queryKey: ["notification-recipients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as NotificationRecipient[];
    },
  });

  const addRecipient = useMutation({
    mutationFn: async (recipient: { phone_number: string; name?: string }) => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .insert({
          phone_number: recipient.phone_number,
          name: recipient.name || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-recipients"] });
    },
  });

  const updateRecipient = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Pick<NotificationRecipient, "phone_number" | "name" | "is_active">>;
    }) => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-recipients"] });
    },
  });

  const deleteRecipient = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notification_recipients")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-recipients"] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from("notification_recipients")
        .update({ is_active })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notification-recipients"] });
    },
  });

  return {
    recipients: recipientsQuery.data ?? [],
    isLoading: recipientsQuery.isLoading,
    error: recipientsQuery.error,
    addRecipient,
    updateRecipient,
    deleteRecipient,
    toggleActive,
  };
};
