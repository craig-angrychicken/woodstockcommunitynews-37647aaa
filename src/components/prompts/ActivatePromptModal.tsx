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
import { supabase } from "@/integrations/supabase/client";

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
      // First, deactivate current active prompt of this type
      const { error: deactivateError } = await supabase
        .from("prompt_versions")
        .update({ is_active: false })
        .eq("prompt_type", promptType)
        .eq("is_active", true);

      if (deactivateError) throw deactivateError;

      // Then activate the selected prompt
      const { error: activateError } = await supabase
        .from("prompt_versions")
        .update({
          is_active: true,
          is_test_draft: false,
        })
        .eq("id", promptId);

      if (activateError) throw activateError;

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
