import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tables } from "@/integrations/supabase/types";

type NotificationRecipient = Tables<"notification_recipients">;

interface EditRecipientDialogProps {
  recipient: NotificationRecipient | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (id: string, updates: { phone_number: string; name?: string }) => Promise<void>;
  isLoading: boolean;
}

export const EditRecipientDialog = ({
  recipient,
  open,
  onOpenChange,
  onUpdate,
  isLoading,
}: EditRecipientDialogProps) => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (recipient) {
      setPhoneNumber(recipient.phone_number);
      setName(recipient.name || "");
    }
  }, [recipient]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!recipient) return;

    if (!phoneNumber.trim()) {
      toast.error("Phone number is required");
      return;
    }

    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(phoneNumber.trim())) {
      toast.error("Phone number must be in E.164 format (e.g., +15005550006)");
      return;
    }

    try {
      await onUpdate(recipient.id, {
        phone_number: phoneNumber.trim(),
        name: name.trim() || undefined,
      });
      toast.success("Recipient updated successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to update recipient");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit SMS Recipient</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone Number (E.164 format)</Label>
            <Input
              id="edit-phone"
              placeholder="+15005550006"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name (optional)</Label>
            <Input
              id="edit-name"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
