import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";

interface TestSourceCardProps {
  id: string;
  name: string;
  url?: string;
  type: string;
  lastFetchAt?: string;
  itemsFetched: number;
  parserConfig?: any;
  onActivate: () => void;
  onRemove: () => void;
  onViewTestArtifacts: () => void;
  onRefresh?: () => void;
}

export const TestSourceCard = ({
  id,
  name,
  url,
  type,
  lastFetchAt,
  itemsFetched,
  parserConfig,
  onActivate,
  onRemove,
  onViewTestArtifacts,
  onRefresh,
}: TestSourceCardProps) => {
  const navigate = useNavigate();

  const handleRunTestQuery = () => {
    navigate("/manual-query", {
      state: {
        environment: "test",
        sourceIds: [id],
        runStages: "manual",
        dateRange: "last7days",
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{name}</CardTitle>
          <Badge variant="secondary">TESTING</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {url && (
          <div className="text-sm text-muted-foreground truncate">
            <span className="font-medium">URL:</span> {url}
          </div>
        )}
        <div className="text-sm">
          <span className="font-medium">Type:</span> {type}
        </div>
        {lastFetchAt ? (
          <div className="text-sm text-muted-foreground">
            Tested on: {format(new Date(lastFetchAt), "MMM d, yyyy")}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Ready to test</div>
        )}
        {lastFetchAt && (
          <div className="text-sm text-muted-foreground">
            Last test results: {itemsFetched} items collected
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleRunTestQuery}>
            <FlaskConical className="h-4 w-4 mr-1" />
            Run Test Query
          </Button>
          {lastFetchAt && (
            <>
              <Button size="sm" onClick={onActivate}>
                Activate
              </Button>
              <Button variant="outline" size="sm" onClick={onViewTestArtifacts}>
                View Test Artifacts
              </Button>
            </>
          )}
          <Button variant="destructive" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
