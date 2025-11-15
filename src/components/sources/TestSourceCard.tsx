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
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

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

  const handleAnalyze = async () => {
    if (!url) {
      toast.error("No URL to analyze");
      return;
    }

    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(URL:\s*|url:\s*)/i, '');

    setIsAnalyzing(true);
    setShowAnalysisModal(true);

    try {
      const functionName = type === 'RSS Feed' ? 'analyze-rss-feed' : 'analyze-source';
      console.log(`Using ${functionName} for ${type}`);

      const { data, error } = await supabase.functions.invoke(functionName, {
        body: { sourceUrl: cleanUrl }
      });

      if (error) throw error;

      console.log('📦 Raw edge function response:', JSON.stringify(data, null, 2));
      console.log('🔍 Analysis object:', data?.analysis);
      console.log('⚙️ SuggestedConfig:', data?.analysis?.suggestedConfig);
      
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
          {url && (
            <Button variant="outline" size="sm" onClick={handleAnalyze}>
              {type === 'RSS Feed' ? 'Rescan RSS Feed' : 'Auto-Detect'}
            </Button>
          )}
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

      <SourceAnalysisModal
        open={showAnalysisModal}
        onOpenChange={setShowAnalysisModal}
        analysisResult={analysisResult}
        isAnalyzing={isAnalyzing}
        onSaveConfig={handleSaveConfig}
        sourceUrl={url}
      />
    </Card>
  );
};
