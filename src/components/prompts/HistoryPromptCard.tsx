import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface HistoryPromptCardProps {
  id: string;
  versionName: string;
  createdAt: string;
  author: string;
  updateNotes?: string;
  isActive: boolean;
  onView: () => void;
  onCompare: () => void;
  onCopyToTestDraft: () => void;
}

export const HistoryPromptCard = ({
  versionName,
  createdAt,
  author,
  updateNotes,
  isActive,
  onView,
  onCompare,
  onCopyToTestDraft,
}: HistoryPromptCardProps) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{versionName}</CardTitle>
          {isActive && <Badge variant="default">ACTIVE</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground">
          {format(new Date(createdAt), "MMM d, yyyy")} • {author}
        </div>
        {updateNotes && (
          <div className="text-sm">
            <span className="font-medium">Notes:</span> {updateNotes}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onView}>
            View
          </Button>
          <Button variant="outline" size="sm" onClick={onCompare}>
            Compare
          </Button>
          <Button variant="outline" size="sm" onClick={onCopyToTestDraft}>
            Copy to Test Draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
