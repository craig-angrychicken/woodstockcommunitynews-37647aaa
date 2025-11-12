import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MousePointer2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InteractiveSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceUrl: string;
  onConfigSelected: (config: any) => void;
  preAnalyzedResults?: {
    suggestedConfig: any;
    sampleArticles: any[];
  };
}

export function InteractiveSelectorModal({
  open,
  onOpenChange,
  sourceUrl,
  onConfigSelected,
  preAnalyzedResults
}: InteractiveSelectorModalProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [detectedConfig, setDetectedConfig] = useState<any>(preAnalyzedResults?.suggestedConfig || null);
  const [previewArticles, setPreviewArticles] = useState<any[]>(preAnalyzedResults?.sampleArticles || []);
  const [iframeKey, setIframeKey] = useState(0);
  const [proxiedUrl, setProxiedUrl] = useState<string>('');
  const [isLoadingProxy, setIsLoadingProxy] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  // Load proxied page when modal opens
  const loadProxiedPage = async () => {
    setIsLoadingProxy(true);
    try {
      const { data, error } = await supabase.functions.invoke('proxy-page', {
        body: { url: sourceUrl }
      });

      if (error) {
        if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
          toast.error('Rate limit reached. Please wait a moment and try again.');
        } else {
          toast.error('Failed to load page for selection');
        }
        throw error;
      }

      // Create a blob URL from the HTML
      const blob = new Blob([data], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setProxiedUrl(url);
    } catch (error) {
      console.error('Failed to load proxied page:', error);
      toast.error('Failed to load page for selection');
    } finally {
      setIsLoadingProxy(false);
    }
  };

  // Set up message listener for iframe communication
  const handleIframeLoad = () => {
    const iframe = document.getElementById('selector-iframe') as HTMLIFrameElement;
    if (!iframe?.contentWindow) return;

    // Send message to activate click handler
    iframe.contentWindow.postMessage({ type: 'REQUEST_CLICK_HANDLER' }, '*');
  };

  // Listen for element selections from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'ELEMENT_SELECTED') {
        const { selector } = event.data;
        if (selector) {
          handleElementSelected(selector);
        }
      } else if (event.data.type === 'HANDLER_READY') {
        toast.success('Click on any article title, link, or image to analyze');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleElementSelected = (selector: string) => {
    console.log('Element clicked:', selector);
    
    // If we have pre-analyzed results, use them
    if (preAnalyzedResults && preAnalyzedResults.sampleArticles.length > 0) {
      setHasSelection(true);
      toast.success(`Found ${preAnalyzedResults.sampleArticles.length} articles using detected pattern`);
      return;
    }

    // No pre-analyzed results, would need to analyze
    toast.error('No pattern detected. Try Auto-Detect first.');
  };

  const handleSave = () => {
    if (detectedConfig) {
      onConfigSelected(detectedConfig);
      onOpenChange(false);
    }
  };

  const handleReset = () => {
    setHasSelection(false);
    setDetectedConfig(null);
    setPreviewArticles([]);
    setIframeKey(prev => prev + 1);
    if (proxiedUrl) {
      URL.revokeObjectURL(proxiedUrl);
      setProxiedUrl('');
    }
    loadProxiedPage();
  };

  // Load proxied page when modal opens
  useEffect(() => {
    if (open && !proxiedUrl && !isLoadingProxy) {
      loadProxiedPage();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(newOpen) => {
      onOpenChange(newOpen);
      if (!newOpen && proxiedUrl) {
        URL.revokeObjectURL(proxiedUrl);
        setProxiedUrl('');
      }
    }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MousePointer2 className="h-5 w-5" />
            Interactive Selector - Click on Any Article
          </DialogTitle>
          <DialogDescription>
            {!hasSelection 
              ? 'Click on any article title, link, or image and we\'ll automatically find all matching articles'
              : `Found ${previewArticles.length} articles - review and save when ready`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Left side - iframe or preview */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted">
            {!hasSelection ? (
              isLoadingProxy ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="ml-2">Loading page...</p>
                </div>
              ) : isAnalyzing ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p className="ml-2">Analyzing pattern...</p>
                </div>
              ) : proxiedUrl ? (
                <iframe
                  key={iframeKey}
                  id="selector-iframe"
                  src={proxiedUrl}
                  className="w-full h-full"
                  onLoad={handleIframeLoad}
                  sandbox="allow-scripts"
                />
              ) : null
            ) : (
              <div className="p-4 space-y-3 overflow-y-auto h-full">
                <h3 className="font-medium">Detected Articles ({previewArticles.length})</h3>
                {previewArticles.map((article, idx) => (
                  <div key={idx} className="border rounded-lg p-3 bg-background hover:bg-accent/50 transition-colors">
                    {article.images?.[0] && (
                      <img src={article.images[0]} alt="" className="w-full h-32 object-cover rounded mb-2" />
                    )}
                    <h4 className="font-medium text-sm">{article.title || 'No title'}</h4>
                    {article.url && (
                      <a 
                        href={article.url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-xs text-primary hover:underline block truncate"
                      >
                        {article.url}
                      </a>
                    )}
                    {article.date && (
                      <p className="text-xs text-muted-foreground mt-1">{article.date}</p>
                    )}
                    {article.excerpt && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{article.excerpt}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right side - config info */}
          <div className="w-80 border rounded-lg p-4 overflow-y-auto">
            <h3 className="font-medium mb-3">Detection Status</h3>
            {!hasSelection ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MousePointer2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <p>Click on any article element on the left to automatically detect the pattern</p>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>• Click an article title</p>
                  <p>• Click an article link</p>
                  <p>• Click an article image</p>
                </div>
              </div>
            ) : detectedConfig ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="font-medium">Pattern Detected</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="font-medium text-muted-foreground mb-1">Container:</p>
                    <Badge variant="secondary" className="text-xs font-mono">
                      {detectedConfig.containerSelector}
                    </Badge>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground mb-1">Articles Found:</p>
                    <Badge variant="default">{previewArticles.length}</Badge>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <Button variant="outline" onClick={handleReset}>
            Start Over
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!hasSelection || !detectedConfig || previewArticles.length === 0}
          >
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
