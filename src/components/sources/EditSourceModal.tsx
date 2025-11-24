import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface EditSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    id: string;
    name: string;
    url?: string;
    type: string;
  };
  onSuccess: () => void;
}

export const EditSourceModal = ({ open, onOpenChange, source, onSuccess }: EditSourceModalProps) => {
  const [name, setName] = useState(source.name);
  const [url, setUrl] = useState(source.url || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("sources")
        .update({
          name: name.trim(),
          url: url.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", source.id);

      if (error) throw error;

      toast.success("RSS source updated successfully");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating source:", error);
      toast.error("Failed to update source");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Source Name *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., City Hall Press Releases"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-url">RSS Feed URL</Label>
            <Input
              id="edit-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              type="url"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
