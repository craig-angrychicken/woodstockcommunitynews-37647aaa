import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, MousePointer2, CheckCircle2, Link as LinkIcon, Image as ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface InteractiveSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceUrl: string;
  onConfigSelected: (config: any) => void;
}

interface ArticleSelection {
  link: { selector: string; text: string; containerSelector?: string; } | null;
  image: { selector: string; src: string; containerSelector?: string; } | null;
}

type SelectionMode = 'link' | 'image' | null;

export function InteractiveSelectorModal({
  open,
  onOpenChange,
  sourceUrl,
  onConfigSelected
}: InteractiveSelectorModalProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [detectedConfig, setDetectedConfig] = useState<any>(null);
  const [previewArticles, setPreviewArticles] = useState<any[]>([]);
  const [iframeKey, setIframeKey] = useState(0);
  const [proxiedUrl, setProxiedUrl] = useState<string>('');
  const [isLoadingProxy, setIsLoadingProxy] = useState(false);
  
  const [selections, setSelections] = useState<ArticleSelection[]>([{ link: null, image: null }]);
  const [currentMode, setCurrentMode] = useState<SelectionMode>(null);
  const [currentSelectionIndex, setCurrentSelectionIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [containerHints, setContainerHints] = useState<string[]>([]);

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
        const { selector, containerSelector, tagName, text, src } = event.data;
        if (selector) {
          handleElementSelected(selector, containerSelector, tagName, text, src);
        }
      } else if (event.data.type === 'HANDLER_READY') {
        toast.success('Ready! Click "Select Link" to start marking articles');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentMode, currentSelectionIndex]);

  const handleElementSelected = (selector: string, containerSelector: string, tagName: string, text: string, src: string) => {
    if (!currentMode) {
      toast.error('Click "Select Link" or "Select Image" first');
      return;
    }

    const newSelections = [...selections];
    
    if (currentMode === 'link') {
      newSelections[currentSelectionIndex].link = { 
        selector, 
        containerSelector,  // Store container info
        text 
      };
      toast.success(`Link selected: ${text}`);
      setCurrentMode(null);
    } else if (currentMode === 'image') {
      // Convert relative URLs to absolute URLs
      const absoluteSrc = src.startsWith('http') ? src : new URL(src, sourceUrl).href;
      newSelections[currentSelectionIndex].image = { 
        selector, 
        containerSelector,  // Store container info
        src: absoluteSrc 
      };
      toast.success('Image selected');
      setCurrentMode(null);
    }

    setSelections(newSelections);
  };

  const handleAddArticle = () => {
    setSelections([...selections, { link: null, image: null }]);
    setCurrentSelectionIndex(selections.length);
  };

  const handleRemoveArticle = (index: number) => {
    const newSelections = selections.filter((_, i) => i !== index);
    setSelections(newSelections);
    if (currentSelectionIndex >= newSelections.length) {
      setCurrentSelectionIndex(Math.max(0, newSelections.length - 1));
    }
  };

  const getCompleteSelections = () => {
    return selections.filter(s => s.link && s.image);
  };

  const canAnalyze = () => {
    return getCompleteSelections().length >= 2;
  };

  const handleAnalyzePattern = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const completeSelections = getCompleteSelections();
    
    if (completeSelections.length < 2) {
      toast.error('Please select at least 2 complete articles (link + image each)');
      return;
    }

    setIsAnalyzing(true);
    try {
      // Use the container selectors that were captured when clicking
      const containerSelectors = completeSelections
        .map(s => s.link?.containerSelector)
        .filter(Boolean);
      
      console.log('Container selectors from clicks:', containerSelectors);
      
      // Use the most common container selector
      const containerSelector = containerSelectors[0] || '.news-list-item';
      
      // Extract link patterns from actual clicked links
      const linkHrefs = completeSelections
        .map(s => s.link?.selector)
        .filter(Boolean);
      
      console.log('Link selectors:', linkHrefs);

      // Build config using the detected container
      const config = {
        containerSelector,
        linkSelector: 'a[href*="news_detail"], a[href*="/news/"], a[href]',
        imageSelector: 'img[src], [style*="background"], [style*="background-image"]',
        titleSelector: 'h1, h2, h3, .news-title, [class*="title"]',
        dateSelector: 'time, .news-date, .date, [datetime], [class*="date"]',
        contentSelector: 'p, .excerpt, .description, [class*="excerpt"]',
        timeout: 30000
      };

      console.log('Generated config from detected containers:', config);

      const { data, error } = await supabase.functions.invoke('test-scrape-config', {
        body: {
          sourceUrl,
          config
        }
      });

      if (error) throw error;

      if (data?.success && data.articles && data.articles.length > 0) {
        setDetectedConfig(config);
        setPreviewArticles(data.articles);
        setShowPreview(true);
        toast.success(`Found ${data.articles.length} matching articles!`);
      } else {
        toast.error('No articles found with this pattern. Try selecting different elements.');
        console.log('Config that found 0 articles:', config);
      }
    } catch (error) {
      console.error('Pattern detection failed:', error);
      toast.error('Failed to test article pattern');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSave = () => {
    if (detectedConfig) {
      onConfigSelected(detectedConfig);
      onOpenChange(false);
    }
  };

  const handleReset = () => {
    setSelections([{ link: null, image: null }]);
    setCurrentMode(null);
    setCurrentSelectionIndex(0);
    setShowPreview(false);
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
            Click to Train - Select Article Links & Images
          </DialogTitle>
          <DialogDescription>
            {!showPreview 
              ? 'Select links and images for at least 2 articles, then click "Analyze Pattern"'
              : `Found ${previewArticles.length} articles - review and save when ready`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Left side - iframe or preview */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted">
            {!showPreview ? (
              isLoadingProxy ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p>Loading page...</p>
                </div>
              ) : isAnalyzing ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <p>Analyzing pattern...</p>
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

          {/* Right side - selections */}
          <div className="w-80 border rounded-lg p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Your Selections</h3>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleAddArticle}
                disabled={showPreview}
              >
                + Add Article
              </Button>
            </div>
            
            {!showPreview ? (
              <div className="space-y-3">
                {selections.map((selection, idx) => (
                  <div key={idx} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Article {idx + 1}</span>
                      {selections.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRemoveArticle(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <div>
                        <Button
                          size="sm"
                          variant={currentMode === 'link' && currentSelectionIndex === idx ? "default" : "outline"}
                          className="w-full justify-start"
                          onClick={() => {
                            setCurrentMode('link');
                            setCurrentSelectionIndex(idx);
                            toast.info('Click on an article link in the page');
                          }}
                          disabled={showPreview}
                        >
                          <LinkIcon className="h-3 w-3 mr-2" />
                          {selection.link ? 'Link Selected ✓' : 'Select Link'}
                        </Button>
                        {selection.link && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            {selection.link.text}
                          </p>
                        )}
                      </div>
                      
                      <div>
                        <Button
                          size="sm"
                          variant={currentMode === 'image' && currentSelectionIndex === idx ? "default" : "outline"}
                          className="w-full justify-start"
                          onClick={() => {
                            setCurrentMode('image');
                            setCurrentSelectionIndex(idx);
                            toast.info('Click on the article image in the page');
                          }}
                          disabled={showPreview}
                        >
                          <ImageIcon className="h-3 w-3 mr-2" />
                          {selection.image ? 'Image Selected ✓' : 'Select Image'}
                        </Button>
                        {selection.image && (
                          <img 
                            src={selection.image.src} 
                            alt="" 
                            className="w-full h-16 object-cover rounded mt-1"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                <div className="pt-2 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Complete selections: {getCompleteSelections().length} / 2 minimum
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleAnalyzePattern}
                    disabled={!canAnalyze() || isAnalyzing}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      'Analyze Pattern'
                    )}
                  </Button>
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
            disabled={!showPreview || !detectedConfig || previewArticles.length === 0}
          >
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
