import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

interface TestPromptCardProps {
  id: string;
  versionName: string;
  basedOnVersionName?: string;
  testStatus: string;
  testResults?: {
    story_count?: number;
    date?: string;
  };
  updateNotes?: string;
  onEdit: () => void;
  onViewResults: () => void;
  onActivate: () => void;
  onDelete: () => void;
}

export const TestPromptCard = ({
  id,
  versionName,
  basedOnVersionName,
  testStatus,
  testResults,
  updateNotes,
  onEdit,
  onViewResults,
  onActivate,
  onDelete,
}: TestPromptCardProps) => {
  const navigate = useNavigate();

  const getStatusBadge = () => {
    switch (testStatus) {
      case "not_tested":
        return <Badge variant="secondary">Not Tested</Badge>;
      case "tested":
        return <Badge variant="outline">Tested</Badge>;
      case "ready_to_activate":
        return <Badge variant="default">Ready to Activate</Badge>;
      default:
        return null;
    }
  };

  const handleRunTestQuery = () => {
    navigate("/manual-query", {
      state: {
        environment: "test",
        promptVersionId: id,
        dateRange: "last7days",
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{versionName}</CardTitle>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {basedOnVersionName && (
          <div className="text-sm text-muted-foreground">Based on: {basedOnVersionName}</div>
        )}
        {testResults && testResults.date && (
          <div className="text-sm text-muted-foreground">
            Last test: {format(new Date(testResults.date), "MMM d, yyyy")} (
            {testResults.story_count || 0} stories)
          </div>
        )}
        {updateNotes && (
          <div className="text-sm">
            <span className="font-medium">Notes:</span> {updateNotes}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={handleRunTestQuery}>
            Run Test Query
          </Button>
          {testStatus !== "not_tested" && (
            <Button variant="outline" size="sm" onClick={onViewResults}>
              View Results
            </Button>
          )}
          {testStatus === "ready_to_activate" && (
            <Button size="sm" onClick={onActivate}>
              Activate
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
