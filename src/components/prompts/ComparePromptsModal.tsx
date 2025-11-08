import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ComparePromptsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt1: {
    version_name: string;
    content: string;
    is_active: boolean;
    created_at: string;
  };
  prompt2: {
    version_name: string;
    content: string;
    is_active: boolean;
    created_at: string;
  };
}

export const ComparePromptsModal = ({
  open,
  onOpenChange,
  prompt1,
  prompt2,
}: ComparePromptsModalProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Compare Prompt Versions</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 h-[60vh]">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{prompt1.version_name}</h3>
              {prompt1.is_active && <Badge variant="default">ACTIVE</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {new Date(prompt1.created_at).toLocaleDateString()}
            </p>
            <ScrollArea className="h-full border rounded-md p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono">{prompt1.content}</pre>
            </ScrollArea>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{prompt2.version_name}</h3>
              {prompt2.is_active && <Badge variant="default">ACTIVE</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {new Date(prompt2.created_at).toLocaleDateString()}
            </p>
            <ScrollArea className="h-full border rounded-md p-4">
              <pre className="text-sm whitespace-pre-wrap font-mono">{prompt2.content}</pre>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
