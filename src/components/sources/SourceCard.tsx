import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { SourceAnalysisModal } from "./SourceAnalysisModal";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

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

  const handleAnalyze = async () => {
    if (!url) {
      toast.error("No URL to analyze");
      return;
    }

    // Clean the URL - remove common prefixes
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(URL:\s*|url:\s*)/i, '');

    setIsAnalyzing(true);
    setShowAnalysisModal(true);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-source', {
        body: { sourceUrl: cleanUrl }
      });

      if (error) throw error;

      setAnalysisResult(data);
      
      if (data.success) {
        toast.success("Analysis complete!");
      } else {
        toast.error(data.error || "Analysis failed");
      }
    } catch (error) {
      console.error("Error analyzing source:", error);
      toast.error("Failed to analyze source");
      setAnalysisResult({ success: false, error: "Failed to analyze source" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveConfig = async (config: any) => {
    try {
      const { error } = await supabase
        .from('sources')
        .update({ parser_config: config })
        .eq('id', id);

      if (error) throw error;

      toast.success("Configuration saved successfully!");
      setShowAnalysisModal(false);
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error("Error saving config:", error);
      toast.error("Failed to save configuration");
    }
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
          {url && (
            <Button variant="outline" size="sm" onClick={handleAnalyze}>
              <FlaskConical className="h-3 w-3 mr-1" />
              Analyze
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onPause}>
            {status === "active" ? "Pause" : "Resume"}
          </Button>
          <Button variant="destructive" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </CardContent>

      <SourceAnalysisModal
        open={showAnalysisModal}
        onOpenChange={setShowAnalysisModal}
        analysisResult={analysisResult}
        isAnalyzing={isAnalyzing}
        onSaveConfig={handleSaveConfig}
      />
    </Card>
  );
};
