import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface EditPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptId: string;
  promptType: string;
  currentContent: string;
  currentVersionName: string;
  isTestDraft?: boolean;
  onSuccess: () => void;
}

export const EditPromptModal = ({
  open,
  onOpenChange,
  promptId,
  promptType,
  currentContent,
  currentVersionName,
  isTestDraft = false,
  onSuccess,
}: EditPromptModalProps) => {
  const [content, setContent] = useState(currentContent);
  const [updateNotes, setUpdateNotes] = useState("");
  const [versionName, setVersionName] = useState(currentVersionName);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!updateNotes.trim()) {
      toast.error("Update notes are required");
      return;
    }

    setIsSaving(true);
    try {
      if (isTestDraft) {
        // Update existing test draft
        const { error } = await supabase
          .from("prompt_versions")
          .update({
            content,
            update_notes: updateNotes,
            version_name: versionName,
            updated_at: new Date().toISOString(),
          })
          .eq("id", promptId);

        if (error) throw error;
        toast.success("Test draft updated successfully");
      } else {
        // Create new version
        const { error } = await supabase.from("prompt_versions").insert({
          version_name: versionName,
          content,
          prompt_type: promptType,
          is_active: false,
          is_test_draft: true,
          update_notes: updateNotes,
          based_on_version_id: promptId,
          test_status: "not_tested",
          author: "User",
        });

        if (error) throw error;
        toast.success("New test draft created successfully");
      }

      onSuccess();
      onOpenChange(false);
      setUpdateNotes("");
    } catch (error) {
      console.error("Error saving prompt:", error);
      toast.error("Failed to save prompt");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isTestDraft ? "Edit Test Draft" : "Create New Version"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="versionName">Version Name</Label>
            <Input
              id="versionName"
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="e.g., Journalism v2.1 DRAFT"
            />
          </div>
          <div>
            <Label htmlFor="content">Prompt Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="updateNotes">Update Notes *</Label>
            <Textarea
              id="updateNotes"
              value={updateNotes}
              onChange={(e) => setUpdateNotes(e.target.value)}
              placeholder="Describe what changed in this version..."
              className="min-h-[100px]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : isTestDraft ? "Update Draft" : "Save as New Version"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
