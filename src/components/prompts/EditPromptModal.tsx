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
  promptId?: string | null;
  promptType?: string;
  currentContent?: string;
  currentVersionName?: string;
  isTestDraft?: boolean;
  editMode?: "direct" | "new_version";
  onSuccess: () => void;
}

export const EditPromptModal = ({
  open,
  onOpenChange,
  promptId,
  promptType = "journalism",
  currentContent = "",
  currentVersionName = "",
  isTestDraft = false,
  editMode = "new_version",
  onSuccess,
}: EditPromptModalProps) => {
  const [content, setContent] = useState(currentContent);
  const [updateNotes, setUpdateNotes] = useState("");
  const [versionName, setVersionName] = useState(currentVersionName);
  const [isSaving, setIsSaving] = useState(false);

  const isCreating = !promptId;

  const handleSave = async () => {
    if (!versionName.trim()) {
      toast.error("Version name is required");
      return;
    }

    if (!content.trim()) {
      toast.error("Prompt content is required");
      return;
    }

    if (!isCreating && !updateNotes.trim()) {
      toast.error("Update notes are required");
      return;
    }

    setIsSaving(true);
    try {
      if (isCreating) {
        // Create brand new prompt
        const { error } = await supabase.from("prompt_versions").insert({
          version_name: versionName,
          content,
          prompt_type: "journalism",
          is_active: false,
          is_test_draft: false,
          update_notes: updateNotes || "Initial version",
          test_status: "not_tested",
          author: "User",
        });

        if (error) throw error;
        toast.success("Prompt created successfully");
      } else if (editMode === "direct") {
        // Direct edit - update the existing prompt in place
        const { error } = await supabase
          .from("prompt_versions")
          .update({
            content,
            version_name: versionName,
            update_notes: updateNotes,
            updated_at: new Date().toISOString(),
          })
          .eq("id", promptId);

        if (error) throw error;
        toast.success("Prompt updated successfully");
      } else if (isTestDraft) {
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
        // Create new version based on existing
        const { error } = await supabase.from("prompt_versions").insert({
          version_name: versionName,
          content,
          prompt_type: "journalism",
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
          <DialogTitle>
            {isCreating ? "Create New Prompt" : editMode === "direct" ? "Edit Prompt" : isTestDraft ? "Edit Test Draft" : "Create New Version"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="versionName">Version Name *</Label>
            <Input
              id="versionName"
              value={versionName}
              onChange={(e) => setVersionName(e.target.value)}
              placeholder="e.g., Journalism v1.0"
            />
          </div>
          
          <div>
            <Label htmlFor="content">Prompt Content *</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[300px] font-mono text-sm"
              placeholder="Enter your prompt content here..."
            />
          </div>
          
          <div>
            <Label htmlFor="updateNotes">
              Update Notes {!isCreating && "*"}
            </Label>
            <Textarea
              id="updateNotes"
              value={updateNotes}
              onChange={(e) => setUpdateNotes(e.target.value)}
              placeholder={isCreating ? "Optional notes about this prompt..." : "Describe what changed in this version..."}
              className="min-h-[100px]"
            />
          </div>
          
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : isCreating ? "Create Prompt" : editMode === "direct" ? "Save Changes" : "Create Version"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
