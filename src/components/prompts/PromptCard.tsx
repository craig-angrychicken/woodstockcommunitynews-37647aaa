import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

interface PromptCardProps {
  versionName: string;
  updatedAt: string;
  isActive?: boolean;
  onEdit: () => void;
  onViewHistory: () => void;
  onCreateTestDraft: () => void;
}

export const PromptCard = ({
  versionName,
  updatedAt,
  isActive = false,
  onEdit,
  onViewHistory,
  onCreateTestDraft,
}: PromptCardProps) => {
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
          Last updated: {format(new Date(updatedAt), "MMM d, yyyy")}
        </div>
        <div className="text-sm text-muted-foreground">
          Usage: Daily auto-runs
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onViewHistory}>
            View History
          </Button>
          <Button variant="outline" size="sm" onClick={onCreateTestDraft}>
            Create Test Draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
