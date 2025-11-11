import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface AnalysisResult {
  success: boolean;
  analysis?: {
    suggestedConfig: {
      containerSelector: string;
      titleSelector: string;
      dateSelector: string;
      linkSelector: string;
      contentSelector: string;
      imageSelector?: string;
    };
    sampleArticles: Array<{
      title: string;
      date: string | null;
      url: string;
      excerpt: string;
    }>;
    confidence: number;
    diagnostics: {
      containersFound: number;
      hasValidTitles: boolean;
      hasValidDates: boolean;
      hasValidLinks: boolean;
      issues: string[];
    };
  };
  error?: string;
}

interface SourceAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisResult: AnalysisResult | null;
  isAnalyzing: boolean;
  onSaveConfig?: (config: any) => void;
}

export const SourceAnalysisModalV2 = ({
  open,
  onOpenChange,
  analysisResult,
  isAnalyzing,
  onSaveConfig,
}: SourceAnalysisModalProps) => {
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 70) {
      return <Badge className="bg-green-500">High ({confidence}%)</Badge>;
    } else if (confidence >= 40) {
      return <Badge className="bg-yellow-500">Medium ({confidence}%)</Badge>;
    } else {
      return <Badge variant="destructive">Low ({confidence}%)</Badge>;
    }
  };

  const handleSaveConfig = () => {
    if (analysisResult?.analysis && onSaveConfig) {
      onSaveConfig(analysisResult.analysis);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Source Analysis</DialogTitle>
          <DialogDescription>
            Analyzing the website structure to detect article patterns
          </DialogDescription>
        </DialogHeader>

        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin mb-4" />
            <p className="text-muted-foreground">Analyzing source structure...</p>
          </div>
        )}

        {!isAnalyzing && analysisResult && !analysisResult.success && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              {analysisResult.error || "Failed to analyze source"}
            </AlertDescription>
          </Alert>
        )}

        {!isAnalyzing && analysisResult?.success && analysisResult.analysis && (
          <div className="space-y-6">
            {/* Confidence Score */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Analysis Confidence</h3>
                <p className="text-sm text-muted-foreground">
                  How confident we are in detecting the correct selectors
                </p>
              </div>
              {getConfidenceBadge(analysisResult.analysis.confidence)}
            </div>

            {/* Diagnostics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Detection Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    {analysisResult.analysis.diagnostics.containersFound > 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm">
                      {analysisResult.analysis.diagnostics.containersFound} containers found
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysisResult.analysis.diagnostics.hasValidTitles ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <span className="text-sm">Valid titles</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysisResult.analysis.diagnostics.hasValidDates ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm">Date information</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysisResult.analysis.diagnostics.hasValidLinks ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="text-sm">Article links</span>
                  </div>
                </div>

                {analysisResult.analysis.diagnostics.issues.length > 0 && (
                  <div className="mt-4 space-y-1">
                    <h4 className="text-sm font-semibold">Issues Found:</h4>
                    {analysisResult.analysis.diagnostics.issues.slice(0, 5).map((issue, i) => (
                      <p key={i} className="text-sm text-muted-foreground">
                        • {issue}
                      </p>
                    ))}
                    {analysisResult.analysis.diagnostics.issues.length > 5 && (
                      <p className="text-sm text-muted-foreground italic">
                        ...and {analysisResult.analysis.diagnostics.issues.length - 5} more
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detected Selectors */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Detected Selectors</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm font-mono">
                  <div>
                    <span className="text-muted-foreground">Container:</span>
                    <p className="mt-1">{analysisResult.analysis.suggestedConfig.containerSelector}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Title:</span>
                    <p className="mt-1">{analysisResult.analysis.suggestedConfig.titleSelector}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Date:</span>
                    <p className="mt-1">{analysisResult.analysis.suggestedConfig.dateSelector}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Link:</span>
                    <p className="mt-1">{analysisResult.analysis.suggestedConfig.linkSelector}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Content:</span>
                    <p className="mt-1">{analysisResult.analysis.suggestedConfig.contentSelector}</p>
                  </div>
                  {analysisResult.analysis.suggestedConfig.imageSelector && (
                    <div>
                      <span className="text-muted-foreground">Images:</span>
                      <p className="mt-1">{analysisResult.analysis.suggestedConfig.imageSelector}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Sample Articles */}
            {analysisResult.analysis.sampleArticles.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">
                    Sample Articles ({analysisResult.analysis.sampleArticles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {analysisResult.analysis.sampleArticles.map((article, index) => (
                    <div key={index} className="border-b last:border-0 pb-3">
                      <h4 className="font-semibold">{article.title || "(No title)"}</h4>
                      {article.date && (
                        <p className="text-sm text-muted-foreground mt-1">{article.date}</p>
                      )}
                      {article.excerpt && (
                        <p className="text-sm text-muted-foreground mt-2">{article.excerpt}</p>
                      )}
                      {article.url && article.url !== "" && (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-500 hover:underline mt-1 inline-block"
                        >
                          View article →
                        </a>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!isAnalyzing && analysisResult?.success && onSaveConfig && (
            <Button onClick={handleSaveConfig}>
              Save Configuration
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
