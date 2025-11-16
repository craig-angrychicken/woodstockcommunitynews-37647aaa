import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle, MousePointer2 } from "lucide-react";
import { InteractiveSelectorModal } from "./InteractiveSelectorModal";

interface AnalysisResult {
  success: boolean;
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
  sampleArticles?: Array<{
    title: string;
    date: string;
    link: string;
    excerpt?: string;
    content?: string;
    images?: string[];
  }>;
  confidence?: number;
  recommendedParser?: string;
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
    if (analysisResult && onSaveConfig) {
      console.log('📊 Analysis Result:', JSON.stringify(analysisResult, null, 2));
      if (analysisResult.suggestedConfig) {
        onSaveConfig({ ...analysisResult.suggestedConfig, confidence: analysisResult.confidence });
      } else if (analysisResult.suggestedSelectors) {
        onSaveConfig({ scrapeConfig: analysisResult.suggestedSelectors, confidence: analysisResult.confidence });
      }
      onOpenChange(false);
    }
  };

  const getSelector = (name: string) => {
    return analysisResult?.suggestedSelectors?.elements.find(el => el.name === name)?.selector || 'N/A';
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Source Analysis Results</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
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

          {!isAnalyzing && analysisResult?.success && (
            <div className="space-y-6">
              {/* Debug info */}
              <div className="text-xs text-muted-foreground p-2 bg-muted rounded">
                Debug: confidence={analysisResult.confidence}, 
                hasConfig={!!analysisResult.suggestedConfig},
                feedType={analysisResult.feedType}
              </div>

              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <h3 className="font-semibold">Confidence Score</h3>
                  <p className="text-sm text-muted-foreground">How likely this configuration will work</p>
                </div>
                {analysisResult.confidence !== undefined && getConfidenceBadge(analysisResult.confidence)}
              </div>

              {analysisResult.feedType && (
                <div>
                  <h3 className="font-semibold mb-2">Feed Type</h3>
                  <Badge variant="outline" className="text-base px-3 py-1">{analysisResult.feedType.toUpperCase()}</Badge>
                </div>
              )}

              {analysisResult.recommendedParser && (
                <div>
                  <h3 className="font-semibold mb-2">Recommended Parser</h3>
                  <Badge variant="outline" className="text-base px-3 py-1">{analysisResult.recommendedParser}</Badge>
                </div>
              )}

              {analysisResult.suggestedConfig && analysisResult.suggestedConfig.fieldMappings && (
                <div>
                  <h3 className="font-semibold mb-3">Field Mappings</h3>
                  <div className="space-y-2 text-sm">
                    {Object.entries(analysisResult.suggestedConfig.fieldMappings).map(([key, value]) => (
                      <div key={key} className="flex flex-col sm:flex-row sm:justify-between items-start gap-2 sm:gap-4">
                        <span className="text-muted-foreground capitalize font-medium min-w-[120px]">
                          {key.replace(/([A-Z])/g, ' $1').replace(/Field$/, '')}:
                        </span>
                        {Array.isArray(value) ? (
                          <div className="flex flex-col items-start sm:items-end gap-1 flex-1">
                            {value.map((field, idx) => (
                              <code key={idx} className="bg-background px-2 py-1 rounded text-xs border break-all max-w-full">{field}</code>
                            ))}
                          </div>
                        ) : (
                          <code className="bg-background px-2 py-1 rounded text-xs border break-all flex-1">{String(value)}</code>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysisResult.suggestedSelectors && (
                <div>
                  <h3 className="font-semibold mb-3">Detected CSS Selectors</h3>
                  <div className="space-y-2">
                    {['container', 'title', 'link', 'date'].map(name => (
                      <div key={name} className="flex flex-col sm:flex-row sm:justify-between gap-2 text-sm">
                        <span className="text-muted-foreground capitalize min-w-[80px]">{name}:</span>
                        <code className="bg-muted px-2 py-1 rounded text-xs break-all flex-1">{getSelector(name)}</code>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-semibold mb-3">Sample Articles</h3>
                <div className="space-y-3">
                  {analysisResult.sampleArticles && analysisResult.sampleArticles.map((article, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-lg space-y-1">
                      <h4 className="font-medium text-sm">{article.title}</h4>
                      <p className="text-xs text-muted-foreground">{article.date}</p>
                      <a href={article.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block break-all">{article.link}</a>
                      {(article.excerpt || article.content) && (
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{article.excerpt || article.content}</p>
                      )}
                      {article.images && article.images.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium mb-1">Images ({article.images.length}):</p>
                          <div className="flex flex-wrap gap-2">
                            {article.images.slice(0, 3).map((img, imgIdx) => (
                              <div key={imgIdx} className="relative w-16 h-16 rounded border bg-muted overflow-hidden">
                                <img 
                                  src={img} 
                                  alt={`Preview ${imgIdx + 1}`} 
                                  className="w-full h-full object-cover" 
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    const parent = target.parentElement;
                                    if (parent && !parent.querySelector('.error-placeholder')) {
                                      const placeholder = document.createElement('div');
                                      placeholder.className = 'error-placeholder absolute inset-0 flex items-center justify-center text-muted-foreground';
                                      placeholder.innerHTML = '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>';
                                      parent.appendChild(placeholder);
                                    }
                                  }} 
                                />
                              </div>
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
          </ScrollArea>

          <DialogFooter className="mt-4 pt-4 border-t">
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
