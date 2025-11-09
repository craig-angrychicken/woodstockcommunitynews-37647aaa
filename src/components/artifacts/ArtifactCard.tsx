import { Badge } from "@/components/ui/badge";
import { TestBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Eye, FileText, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface ArtifactCardProps {
  artifact: {
    id: string;
    name: string;
    title: string | null;
    guid: string;
    date: string;
    source_id: string;
  };
  sourceName: string;
  isTest: boolean;
  storiesCount: number;
  imageCount: number;
  onViewContent: () => void;
  onViewStory: () => void;
  onDelete: () => void;
}

export const ArtifactCard = ({
  artifact,
  sourceName,
  isTest,
  storiesCount,
  imageCount,
  onViewContent,
  onViewStory,
  onDelete,
}: ArtifactCardProps) => {
  const handleCopyGuid = () => {
    navigator.clipboard.writeText(artifact.guid);
    toast.success("GUID copied to clipboard");
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/artifacts?id=${artifact.id}`;
    navigator.clipboard.writeText(link);
    toast.success("Link copied to clipboard");
  };

  return (
    <Card className="hover:border-primary transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-muted-foreground">{sourceName}</span>
            {isTest && <TestBadge />}
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(artifact.date).toLocaleDateString()}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <h3 className="font-semibold line-clamp-2">
          {artifact.title || artifact.name}
        </h3>

        {imageCount > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Images: {imageCount}</span>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">GUID:</span>
            <div className="flex items-center gap-1">
              <code className="text-xs bg-muted px-2 py-1 rounded">
                {artifact.guid.substring(0, 8)}...
              </code>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleCopyGuid}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Usage:</span>
            <span className="font-medium">
              {storiesCount > 0 ? (
                <span className="text-success">
                  Used in {storiesCount} {storiesCount === 1 ? 'story' : 'stories'}
                </span>
              ) : (
                <span className="text-warning">Not used</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onViewContent} className="flex-1">
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          {storiesCount > 0 && (
            <Button variant="outline" size="sm" onClick={onViewStory}>
              <FileText className="h-4 w-4 mr-1" />
              Story
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
