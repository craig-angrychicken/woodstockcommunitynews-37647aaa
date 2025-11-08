import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Artifact {
  id: string;
  title: string | null;
  name: string;
  date: string;
  guid: string;
  source_name?: string;
}

interface ArtifactsModalProps {
  artifacts: Artifact[];
  open: boolean;
  onClose: () => void;
}

export const ArtifactsModal = ({ artifacts, open, onClose }: ArtifactsModalProps) => {
  const { toast } = useToast();

  const handleCopyLink = (guid: string) => {
    navigator.clipboard.writeText(guid);
    toast({
      title: "Copied!",
      description: "Artifact GUID copied to clipboard",
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Source Artifacts</DialogTitle>
          <DialogDescription>
            {artifacts.length} artifact(s) used in this story
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {artifacts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No artifacts linked to this story
            </div>
          ) : (
            artifacts.map((artifact) => (
              <Card key={artifact.id}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-start justify-between">
                    <span className="line-clamp-2">
                      {artifact.title || artifact.name}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm space-y-1">
                    {artifact.source_name && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Source:</span>
                        <span className="font-medium">{artifact.source_name}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Date:</span>
                      <span className="font-medium">
                        {new Date(artifact.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-muted-foreground">GUID:</span>
                      <code className="text-xs bg-muted px-2 py-1 rounded break-all">
                        {artifact.guid}
                      </code>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1">
                      <Eye className="h-4 w-4 mr-2" />
                      View Content
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyLink(artifact.guid)}
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Link
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
