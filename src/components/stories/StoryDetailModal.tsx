import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, Send, Trash2, XCircle, Package } from "lucide-react";
import { Label } from "@/components/ui/label";

interface StoryDetailModalProps {
  story: {
    id: string;
    title: string;
    content: string | null;
    status: string;
    is_test: boolean;
    article_type: string;
    prompt_version_id: string | null;
    guid: string;
    created_at: string;
    environment: string;
  } | null;
  open: boolean;
  onClose: () => void;
  onSave: (content: string) => void;
  onPublish: () => void;
  onDelete: () => void;
  onReject: () => void;
  onViewArtifacts: () => void;
}

export const StoryDetailModal = ({
  story,
  open,
  onClose,
  onSave,
  onPublish,
  onDelete,
  onReject,
  onViewArtifacts,
}: StoryDetailModalProps) => {
  const [editedContent, setEditedContent] = useState(story?.content || "");

  // Update editedContent when story changes
  useEffect(() => {
    setEditedContent(story?.content || "");
  }, [story?.content]);

  if (!story) return null;

  const handleSave = () => {
    onSave(editedContent);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{story.title}</DialogTitle>
          <DialogDescription className="space-y-2 pt-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="capitalize">
                {story.status}
              </Badge>
              {story.is_test && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                  🧪 TEST
                </Badge>
              )}
              <Badge variant="outline">{story.environment}</Badge>
              <Badge variant="outline" className="capitalize">{story.article_type}</Badge>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-sm pt-2">
              <div>
                <span className="font-semibold">Date: </span>
                {new Date(story.created_at).toLocaleString()}
              </div>
              {story.prompt_version_id && (
                <div>
                  <span className="font-semibold">Prompt Version: </span>
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">
                    {story.prompt_version_id}
                  </code>
                </div>
              )}
              <div className="col-span-2">
                <span className="font-semibold">GUID: </span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{story.guid}</code>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="content">Story Content</Label>
            <Textarea
              id="content"
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="min-h-[300px] mt-2 font-mono text-sm"
              placeholder="Enter story content..."
            />
          </div>

          <Button variant="outline" onClick={onViewArtifacts} className="w-full">
            <Package className="h-4 w-4 mr-2" />
            View Source Artifacts
          </Button>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save Edits
          </Button>
          {story.status === 'pending' && (
            <Button variant="default" onClick={onPublish}>
              <Send className="h-4 w-4 mr-2" />
              Publish to Ghost
            </Button>
          )}
          <Button variant="outline" onClick={onReject} className="text-orange-600">
            <XCircle className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
