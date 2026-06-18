import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";

interface ActivatePromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptId: string;
  promptType: string;
  versionName: string;
  onSuccess: () => void;
}

export const ActivatePromptModal = ({
  open,
  onOpenChange,
  promptId,
  promptType,
  versionName,
  onSuccess,
}: ActivatePromptModalProps) => {
  const [isActivating, setIsActivating] = useState(false);

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      // Atomic transaction on the server: deactivate the current active
      // prompt of this type, then activate the selected one and clear its
      // test-draft flag.
      await api.patch(`/prompt-versions/${promptId}/activate`, {
        promptType,
      });

      toast.success(`${versionName} is now active`);
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error activating prompt:", error);
      toast.error("Failed to activate prompt");
    } finally {
      setIsActivating(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Activate Prompt Version?</AlertDialogTitle>
          <AlertDialogDescription>
            This will make <strong>{versionName}</strong> the active prompt and deactivate the
            current version. This change will affect all future runs.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleActivate} disabled={isActivating}>
            {isActivating ? "Activating..." : "Activate"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
