import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, MousePointer2 } from "lucide-react";
import { InteractiveSelectorModal } from "./InteractiveSelectorModal";

interface AnalysisResult {
  success: boolean;
  analysis?: {
    suggestedSelectors: {
      elements: Array<{
        selector: string;
        name?: string;
        timeout?: number;
      }>;
      gotoOptions?: {
        waitUntil?: string;
        timeout?: number;
      };
    };
    sampleArticles: Array<{
      title: string;
      date: string;
      link: string;
      excerpt: string;
    }>;
    confidence: number;
    recommendedParser: string;
  };
  error?: string;
}

interface SourceAnalysisModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysisResult: AnalysisResult | null;
  isAnalyzing: boolean;
  onSaveConfig?: (config: any) => void;
  sourceUrl?: string;
}

export const SourceAnalysisModal = ({
  open,
  onOpenChange,
  analysisResult,
  isAnalyzing,
  onSaveConfig,
  sourceUrl,
}: SourceAnalysisModalProps) => {
  const [showInteractiveSelector, setShowInteractiveSelector] = useState(false);
  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 80) return <Badge className="bg-green-500">High ({confidence}%)</Badge>;
    if (confidence >= 50) return <Badge className="bg-yellow-500">Medium ({confidence}%)</Badge>;
    return <Badge variant="destructive">Low ({confidence}%)</Badge>;
  };

  const handleSaveConfig = () => {
    if (analysisResult?.analysis && onSaveConfig) {
      const config = {
        scrapeConfig: analysisResult.analysis.suggestedSelectors,
        confidence: analysisResult.analysis.confidence,
      };
      onSaveConfig(config);
      onOpenChange(false);
    }
  };

  // Helper to get selector by name from elements array
  const getSelector = (name: string) => {
    const element = analysisResult?.analysis?.suggestedSelectors.elements.find(
      el => el.name === name
    );
    return element?.selector || 'N/A';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Source Analysis Results</DialogTitle>
        </DialogHeader>

        {isAnalyzing && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-3">Analyzing source structure...</span>
          </div>
        )}

        {!isAnalyzing && analysisResult?.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{analysisResult.error}</AlertDescription>
          </Alert>
        )}

        {!isAnalyzing && analysisResult?.success && analysisResult.analysis && (
          <div className="space-y-6">
            {/* Confidence Score */}
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <div>
                <h3 className="font-semibold">Confidence Score</h3>
                <p className="text-sm text-muted-foreground">
                  How likely this configuration will work
                </p>
              </div>
              {getConfidenceBadge(analysisResult.analysis.confidence)}
            </div>

            {/* Recommended Parser */}
            <div>
              <h3 className="font-semibold mb-2">Recommended Parser</h3>
              <Badge variant="outline" className="text-base px-3 py-1">
                {analysisResult.analysis.recommendedParser}
              </Badge>
            </div>

            {/* Detected Selectors */}
            <div>
              <h3 className="font-semibold mb-2">Detected Selectors</h3>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-sm text-muted-foreground">Container:</span>
                    <code className="block mt-1 p-2 bg-muted rounded text-sm">
                      {getSelector('container')}
                    </code>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Title:</span>
                    <code className="block mt-1 p-2 bg-muted rounded text-sm">
                      {getSelector('title')}
                    </code>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Date:</span>
                    <code className="block mt-1 p-2 bg-muted rounded text-sm">
                      {getSelector('date')}
                    </code>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Link:</span>
                    <code className="block mt-1 p-2 bg-muted rounded text-sm">
                      {getSelector('link')}
                    </code>
                  </div>
                </div>
              </div>
            </div>

            {/* Sample Articles */}
            {analysisResult.analysis.sampleArticles && analysisResult.analysis.sampleArticles.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Sample Articles Found</h3>
                <div className="space-y-3">
                  {analysisResult.analysis.sampleArticles.map((article, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg">
                      <div className="font-medium">{article.title || 'No title detected'}</div>
                      {article.date && (
                        <div className="text-sm text-muted-foreground mt-1">
                          Date: {article.date}
                        </div>
                      )}
                      {article.link && (
                        <div className="text-sm text-muted-foreground mt-1 truncate">
                          Link: {article.link}
                        </div>
                      )}
                      {article.excerpt && (
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {article.excerpt}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Configuration Preview */}
            <div>
              <h3 className="font-semibold mb-2">Configuration Preview</h3>
              <div className="p-3 bg-muted rounded-lg text-sm">
                <pre className="text-xs overflow-x-auto">
                  {JSON.stringify(analysisResult.analysis.suggestedSelectors, null, 2)}
                </pre>
              </div>
            </div>

            {analysisResult.analysis.confidence < 50 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Low confidence score. The parser may not work reliably. Consider testing
                  thoroughly before activating this source.
                </AlertDescription>
              </Alert>
            )}

            {analysisResult.analysis.confidence >= 50 && (
              <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <AlertDescription className="text-green-800 dark:text-green-200">
                  This configuration looks promising! You can save it and test the source.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <div className="flex items-center gap-2 flex-1">
            {sourceUrl && (
              <Button 
                variant="outline" 
                onClick={() => setShowInteractiveSelector(true)}
              >
                <MousePointer2 className="h-4 w-4 mr-2" />
                Click to Train
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {analysisResult?.success && analysisResult.analysis && onSaveConfig && (
              <Button onClick={handleSaveConfig}>
                Save Configuration
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
      
      <InteractiveSelectorModal
        open={showInteractiveSelector}
        onOpenChange={setShowInteractiveSelector}
        sourceUrl={sourceUrl || ''}
        onConfigSelected={(config) => {
          if (onSaveConfig) {
            onSaveConfig(config);
          }
          setShowInteractiveSelector(false);
        }}
      />
    </Dialog>
  );
};
