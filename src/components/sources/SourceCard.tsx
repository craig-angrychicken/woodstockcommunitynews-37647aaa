import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

interface SourceCardProps {
  id: string;
  name: string;
  url?: string;
  type: string;
  lastFetchAt?: string;
  itemsFetched: number;
  status: string;
  parserConfig?: any;
  onEdit: () => void;
  onPause: () => void;
  onRemove: () => void;
  onRefresh?: () => void;
}

export const SourceCard = ({
  id,
  name,
  url,
  type,
  lastFetchAt,
  itemsFetched,
  status,
  parserConfig,
  onEdit,
  onPause,
  onRemove,
  onRefresh,
}: SourceCardProps) => {
  const navigate = useNavigate();

  const handleTest = () => {
    navigate("/manual-query", {
      state: {
        environment: "test",
        sourceIds: [id],
        runStages: "manual",
        dateRange: "last7days",
      },
    });
  };

  const getHealthStatus = () => {
    if (parserConfig) {
      const confidence = parserConfig.confidence || 0;
      if (confidence >= 80) return { color: "bg-green-500", label: "Healthy" };
      if (confidence >= 50) return { color: "bg-yellow-500", label: "Moderate" };
      return { color: "bg-red-500", label: "Low Confidence" };
    }
    return { color: "bg-gray-400", label: "Not Configured" };
  };

  const healthStatus = getHealthStatus();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{name}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className={`h-2 w-2 rounded-full ${healthStatus.color}`} />
              <span className="text-xs text-muted-foreground">{healthStatus.label}</span>
            </div>
            <Badge variant="default">{status.toUpperCase()}</Badge>
          </div>
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
        {lastFetchAt && (
          <div className="text-sm text-muted-foreground">
            Last fetch: {format(new Date(lastFetchAt), "MMM d, yyyy HH:mm")}
          </div>
        )}
        <div className="text-sm text-muted-foreground">
          Items collected: {itemsFetched}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest}>
            Test
          </Button>
          <Button variant="outline" size="sm" onClick={onPause}>
            {status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button variant="destructive" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
