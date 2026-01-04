import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useNotificationRecipients } from "@/hooks/useNotificationRecipients";
import { AddRecipientDialog } from "@/components/notifications/AddRecipientDialog";
import { EditRecipientDialog } from "@/components/notifications/EditRecipientDialog";
import { RecipientRow } from "@/components/notifications/RecipientRow";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SmsSettingsCard } from "@/components/notifications/SmsSettingsCard";
import { MessageSquare, Bell, Send } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type NotificationRecipient = Tables<"notification_recipients">;

const NotificationRecipients = () => {
  const {
    recipients,
    isLoading,
    addRecipient,
    updateRecipient,
    deleteRecipient,
    toggleActive,
  } = useNotificationRecipients();

  const [editingRecipient, setEditingRecipient] = useState<NotificationRecipient | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const handleSendTestSMS = async () => {
    setIsSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-sms-notification", {
        body: {
          storyId: "test-" + Date.now(),
          storyTitle: "🧪 Test SMS from AI Journalist",
        },
      });

      if (error) throw error;

      if (data?.sent === 0) {
        toast.warning("No active recipients to send test SMS to");
      } else {
        toast.success(`Test SMS sent to ${data?.sent || 0} recipient(s)`);
      }
    } catch (error: any) {
      console.error("Error sending test SMS:", error);
      toast.error(error.message || "Failed to send test SMS");
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleAdd = async (data: { phone_number: string; name?: string }) => {
    await addRecipient.mutateAsync(data);
  };

  const handleUpdate = async (id: string, updates: { phone_number: string; name?: string }) => {
    await updateRecipient.mutateAsync({ id, updates });
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      await deleteRecipient.mutateAsync(deletingId);
      toast.success("Recipient deleted");
    } catch (error) {
      toast.error("Failed to delete recipient");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (id: string, is_active: boolean) => {
    try {
      await toggleActive.mutateAsync({ id, is_active });
      toast.success(is_active ? "Notifications enabled" : "Notifications disabled");
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8" />
            SMS Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage recipients who receive SMS alerts when new stories are ready
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleSendTestSMS}
            disabled={isSendingTest || recipients.length === 0}
          >
            <Send className="h-4 w-4 mr-2" />
            {isSendingTest ? "Sending..." : "Send Test SMS"}
          </Button>
          <AddRecipientDialog onAdd={handleAdd} isLoading={addRecipient.isPending} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Recipients
          </CardTitle>
          <CardDescription>
            Phone numbers that will receive SMS notifications for new stories
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recipients.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No recipients configured yet</p>
              <p className="text-sm">Add a phone number to start receiving SMS notifications</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone Number</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recipients.map((recipient) => (
                  <RecipientRow
                    key={recipient.id}
                    recipient={recipient}
                    onEdit={setEditingRecipient}
                    onDelete={setDeletingId}
                    onToggleActive={handleToggleActive}
                    isToggling={toggleActive.isPending}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <EditRecipientDialog
        recipient={editingRecipient}
        open={!!editingRecipient}
        onOpenChange={(open) => !open && setEditingRecipient(null)}
        onUpdate={handleUpdate}
        isLoading={updateRecipient.isPending}
      />

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => !open && setDeletingId(null)}
        title="Delete Recipient"
        description="Are you sure you want to remove this recipient? They will no longer receive SMS notifications."
        confirmLabel="Delete"
        onConfirm={handleDelete}
        variant="destructive"
      />

      {/* SMS Settings Card */}
      <div className="mt-6">
        <SmsSettingsCard />
      </div>
    </main>
  );
};

export default NotificationRecipients;
