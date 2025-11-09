import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TestBadge } from "@/components/ui/status-badge";
import { CopyText } from "@/components/ui/copy-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Trash2, ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "react-router-dom";
import { useState } from "react";

interface ArtifactDetailModalProps {
  artifact: {
    id: string;
    name: string;
    title: string | null;
    content: string | null;
    guid: string;
    date: string;
    size_mb: number;
    type: string;
  } | null;
  sourceName: string;
  isTest: boolean;
  stories: Array<{ id: string; title: string }>;
  open: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export const ArtifactDetailModal = ({
  artifact,
  sourceName,
  isTest,
  stories,
  open,
  onClose,
  onDelete,
}: ArtifactDetailModalProps) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!artifact) return null;

  const handleDelete = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="text-2xl">
              {artifact.title || artifact.name}
            </DialogTitle>
            <DialogDescription className="space-y-2 pt-2">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{sourceName}</Badge>
                {isTest && <TestBadge />}
                <Badge variant="outline">{artifact.type}</Badge>
                <Badge variant="outline">{artifact.size_mb.toFixed(2)} MB</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm pt-2">
                <div>
                  <span className="font-semibold">Fetch Date: </span>
                  {new Date(artifact.date).toLocaleString()}
                </div>
                <div>
                  <span className="font-semibold">Usage: </span>
                  {stories.length > 0 ? (
                    <span className="text-success">
                      Used in {stories.length} {stories.length === 1 ? 'story' : 'stories'}
                    </span>
                  ) : (
                    <span className="text-warning">Not used</span>
                  )}
                </div>
                <div className="col-span-2">
                  <span className="font-semibold mr-2">GUID:</span>
                  <CopyText text={artifact.guid} displayText={artifact.guid.substring(0, 8) + "..."} />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Content</h3>
              <ScrollArea className="h-[300px] w-full rounded-md border p-4">
                <div className="text-sm font-mono whitespace-pre-wrap break-all select-text">
                  {artifact.content || 'No content available'}
                </div>
              </ScrollArea>
            </div>

            {stories.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Stories Using This Artifact</h3>
                <div className="space-y-2">
                  {stories.map((story) => (
                    <Link
                      key={story.id}
                      to={`/stories?id=${story.id}`}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-sm">{story.title}</span>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Artifact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Artifact?"
        description={
          stories.length > 0
            ? `⚠️ Warning: This artifact is used in ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}. Deleting it may affect those stories. This action cannot be undone.`
            : "This will permanently remove this artifact. This action cannot be undone."
        }
        confirmLabel="Delete Artifact"
        variant="destructive"
        onConfirm={confirmDelete}
      />
    </>
  );
};
