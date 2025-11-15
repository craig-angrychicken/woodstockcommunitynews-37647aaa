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
    feedType?: string;
    suggestedConfig?: {
      feedType: string;
      fieldMappings: {
        titleField: string;
        linkField: string;
        dateField: string;
        contentField: string;
        imageFields: string[];
      };
    };
    suggestedSelectors?: {
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
      excerpt?: string;
      content?: string;
      images?: string[];
    }>;
    confidence: number;
    recommendedParser?: string;
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
      console.log('📊 Analysis Result:', JSON.stringify(analysisResult.analysis, null, 2));
      if (analysisResult.analysis.suggestedConfig) {
        onSaveConfig({ ...analysisResult.analysis.suggestedConfig, confidence: analysisResult.analysis.confidence });
      } else if (analysisResult.analysis.suggestedSelectors) {
        onSaveConfig({ scrapeConfig: analysisResult.analysis.suggestedSelectors, confidence: analysisResult.analysis.confidence });
      }
      onOpenChange(false);
    }
  };

  const getSelector = (name: string) => {
    return analysisResult?.analysis?.suggestedSelectors?.elements.find(el => el.name === name)?.selector || 'N/A';
  };

  return (
    <>
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
              {/* Debug info */}
              <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                Debug: confidence={analysisResult.analysis.confidence}, 
                hasConfig={!!analysisResult.analysis.suggestedConfig},
                feedType={analysisResult.analysis.feedType}
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <h3 className="font-semibold">Confidence Score</h3>
                  <p className="text-sm text-muted-foreground">How likely this configuration will work</p>
                </div>
                {analysisResult.analysis.confidence !== undefined && getConfidenceBadge(analysisResult.analysis.confidence)}
              </div>

              {analysisResult.analysis.feedType && (
                <div>
                  <h3 className="font-semibold mb-2">Feed Type</h3>
                  <Badge variant="outline" className="text-base px-3 py-1">{analysisResult.analysis.feedType.toUpperCase()}</Badge>
                </div>
              )}

              {analysisResult.analysis.recommendedParser && (
                <div>
                  <h3 className="font-semibold mb-2">Recommended Parser</h3>
                  <Badge variant="outline" className="text-base px-3 py-1">{analysisResult.analysis.recommendedParser}</Badge>
                </div>
              )}

              {analysisResult.analysis.suggestedConfig && analysisResult.analysis.suggestedConfig.fieldMappings && (
                <div>
                  <h3 className="font-semibold mb-3">Field Mappings</h3>
                  <div className="space-y-2 text-sm">
                    {Object.entries(analysisResult.analysis.suggestedConfig.fieldMappings).map(([key, value]) => (
                      <div key={key} className="flex justify-between items-start gap-4">
                        <span className="text-muted-foreground capitalize font-medium min-w-[120px]">
                          {key.replace(/([A-Z])/g, ' $1').replace(/Field$/, '')}:
                        </span>
                        {Array.isArray(value) ? (
                          <div className="flex flex-col items-end gap-1">
                            {value.map((field, idx) => (
                              <code key={idx} className="bg-background px-2 py-1 rounded text-xs border">{field}</code>
                            ))}
                          </div>
                        ) : (
                          <code className="bg-background px-2 py-1 rounded text-xs border">{String(value)}</code>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysisResult.analysis.suggestedSelectors && (
                <div>
                  <h3 className="font-semibold mb-3">Detected CSS Selectors</h3>
                  <div className="space-y-2">
                    {['container', 'title', 'link', 'date'].map(name => (
                      <div key={name} className="flex justify-between text-sm">
                        <span className="text-muted-foreground capitalize">{name}:</span>
                        <code className="bg-muted px-2 py-1 rounded text-xs max-w-md truncate">{getSelector(name)}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-3">Sample Articles</h3>
                <div className="space-y-3">
                  {analysisResult.analysis.sampleArticles.map((article, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg space-y-1">
                      <h4 className="font-medium text-sm">{article.title}</h4>
                      <p className="text-xs text-muted-foreground">{article.date}</p>
                      <a href={article.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block truncate">{article.link}</a>
                      {(article.excerpt || article.content) && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{article.excerpt || article.content}</p>
                      )}
                      {article.images && article.images.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium mb-1">Images ({article.images.length}):</p>
                          <div className="flex flex-wrap gap-2">
                            {article.images.slice(0, 3).map((img, imgIdx) => (
                              <img key={imgIdx} src={img} alt={`Preview ${imgIdx + 1}`} className="w-16 h-16 object-cover rounded border" 
                                onError={(e) => (e.target as HTMLImageElement).src = '/placeholder.svg'} />
                            ))}
                            {article.images.length > 3 && (
                              <div className="w-16 h-16 flex items-center justify-center bg-muted rounded border text-xs">+{article.images.length - 3}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {sourceUrl && <Button variant="outline" onClick={() => setShowInteractiveSelector(true)}><MousePointer2 className="h-4 w-4 mr-2" />Interactive Selector</Button>}
            {!isAnalyzing && analysisResult?.success && <Button onClick={handleSaveConfig}>Save Configuration</Button>}
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {sourceUrl && <InteractiveSelectorModal open={showInteractiveSelector} onOpenChange={setShowInteractiveSelector} sourceUrl={sourceUrl} onConfigSelected={onSaveConfig || (() => {})} />}
    </>
  );
};
