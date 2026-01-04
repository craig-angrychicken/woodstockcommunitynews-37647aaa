import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface AddRecipientDialogProps {
  onAdd: (recipient: { phone_number: string; name?: string }) => Promise<void>;
  isLoading: boolean;
}

export const AddRecipientDialog = ({ onAdd, isLoading }: AddRecipientDialogProps) => {
  const [open, setOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!phoneNumber.trim()) {
      toast.error("Phone number is required");
      return;
    }

    // Basic E.164 format validation
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    if (!e164Regex.test(phoneNumber.trim())) {
      toast.error("Phone number must be in E.164 format (e.g., +15005550006)");
      return;
    }

    try {
      await onAdd({
        phone_number: phoneNumber.trim(),
        name: name.trim() || undefined,
      });
      toast.success("Recipient added successfully");
      setPhoneNumber("");
      setName("");
      setOpen(false);
    } catch (error) {
      toast.error("Failed to add recipient");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Add Recipient
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add SMS Recipient</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number (E.164 format)</Label>
            <Input
              id="phone"
              placeholder="+15005550006"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Include country code (e.g., +1 for US)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Adding..." : "Add Recipient"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
