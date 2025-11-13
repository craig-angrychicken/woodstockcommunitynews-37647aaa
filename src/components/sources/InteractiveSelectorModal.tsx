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

interface ContainerSelection {
  selector: string;
  html: string;
}

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
  const [renderedHtml, setRenderedHtml] = useState<string>('');
  
  const [selectedContainers, setSelectedContainers] = useState<ContainerSelection[]>([]);
  const [containersFound, setContainersFound] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

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

      // Store the rendered HTML for later analysis (avoid second Browserless call)
      setRenderedHtml(data);

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

  // Helper to get live HTML snapshot from iframe
  const getIframeHtmlSnapshot = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const iframe = document.getElementById('selector-iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) {
        return reject(new Error('Iframe not ready'));
      }

      const handler = (event: MessageEvent) => {
        if (event.data?.type === 'HTML_SNAPSHOT') {
          window.removeEventListener('message', handler);
          resolve(event.data.html as string);
        }
      };

      window.addEventListener('message', handler);
      iframe.contentWindow.postMessage({ type: 'REQUEST_HTML_SNAPSHOT' }, '*');

      // Timeout after 3 seconds
      setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('HTML snapshot timed out'));
      }, 3000);
    });
  };

  // Listen for container selections from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'CONTAINER_SELECTED') {
        const { selector, html, isSelected, totalSelected } = event.data;
        
        if (isSelected) {
          setSelectedContainers(prev => [...prev, { selector, html }]);
          toast.success(`Container selected (${totalSelected} total)`);
        } else {
          setSelectedContainers(prev => prev.filter(c => c.selector !== selector));
          toast.info(`Container deselected (${totalSelected} total)`);
        }
      } else if (event.data.type === 'HANDLER_READY') {
        const count = event.data.containersFound || 0;
        setContainersFound(count);
        if (count > 0) {
          toast.success(`Detected ${count} article containers - click 2 to establish pattern`);
        } else {
          toast.error('No article containers detected on this page');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleAnalyzePattern = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (selectedContainers.length < 2) {
      toast.error('Please select at least 2 article containers');
      return;
    }

    setIsAnalyzing(true);
    try {
      // Use the first container's selector (they should all be the same)
      const containerSelector = selectedContainers[0].selector;
      
      // Parse the HTML of selected containers to extract common selectors
      const parser = new DOMParser();
      const sampleHTMLs = selectedContainers.map(c => {
        const doc = parser.parseFromString(c.html, 'text/html');
        return doc.body;
      });
      
      // Extract link selectors (prioritize links with article/news/detail patterns)
      const linkSelectors: string[] = [];
      sampleHTMLs.forEach(container => {
        const links = container.querySelectorAll('a[href]');
        links.forEach(link => {
          const href = link.getAttribute('href') || '';
          const classes = link.className;
          if (href.includes('news') || href.includes('detail') || href.includes('article') || classes.includes('title')) {
            const selector = classes ? `a.${classes.split(' ').join('.')}` : 'a[href]';
            if (!linkSelectors.includes(selector)) linkSelectors.push(selector);
          }
        });
      });
      
      // Extract image selectors
      const imageSelectors: string[] = [];
      sampleHTMLs.forEach(container => {
        const images = container.querySelectorAll('img[src], [style*="background"]');
        images.forEach(img => {
          const classes = img.className;
          if (classes) {
            const selector = `.${classes.split(' ').join('.')}`;
            if (!imageSelectors.includes(selector)) imageSelectors.push(selector);
          }
        });
      });
      
      // Extract title selectors (h1-h6 or elements with "title" in class)
      const titleSelectors: string[] = [];
      sampleHTMLs.forEach(container => {
        const titles = container.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title"]');
        titles.forEach(title => {
          const classes = title.className;
          const tag = title.tagName.toLowerCase();
          const selector = classes ? `.${classes.split(' ').join('.')}` : tag;
          if (!titleSelectors.includes(selector)) titleSelectors.push(selector);
        });
      });
      
      // Build config from analyzed patterns
      const config = {
        containerSelector,
        linkSelector: linkSelectors.length > 0 
          ? linkSelectors.join(', ')
          : 'a[href*="news"], a[href*="detail"], a[href]',
        imageSelector: imageSelectors.length > 0
          ? imageSelectors.join(', ') + ', img[src], [style*="background"]'
          : 'img[src], [style*="background"]',
        titleSelector: titleSelectors.length > 0
          ? titleSelectors.join(', ')
          : 'h1, h2, h3, [class*="title"]',
        dateSelector: 'time, .date, [datetime], [class*="date"]',
        contentSelector: 'p, .excerpt, .description, [class*="content"]',
        timeout: 30000
      };

      console.log('Generated config from container analysis:', config);

      // Get live HTML snapshot from iframe (includes JS-rendered content)
      let snapshotHtml = renderedHtml;
      try {
        console.log('📸 Requesting live HTML snapshot from iframe...');
        snapshotHtml = await getIframeHtmlSnapshot();
        console.log('✅ Got live HTML snapshot, length:', snapshotHtml.length);
      } catch (error) {
        console.warn('⚠️ Failed to get live snapshot, using initial HTML:', error);
        toast.warning('Using initial HTML (snapshot failed)');
      }

      // Validate selector works in the live HTML before calling backend
      const validationParser = new DOMParser();
      const validationDoc = validationParser.parseFromString(snapshotHtml, 'text/html');
      const matchCount = validationDoc.querySelectorAll(containerSelector).length;
      
      console.log(`Validating selector "${containerSelector}" → ${matchCount} matches in live DOM`);
      
      if (matchCount === 0) {
        toast.error(`Generated selector "${containerSelector}" doesn't match any elements in live DOM! Try selecting different containers.`);
        setIsAnalyzing(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('test-scrape-config', {
        body: {
          sourceUrl,
          config,
          html: snapshotHtml  // Use live snapshot instead of stale initial HTML
        }
      });

      if (error) throw error;

      if (data?.success) {
        if (data.articles && data.articles.length > 0) {
          setDetectedConfig(config);
          setPreviewArticles(data.articles);
          setShowPreview(true);
          toast.success(`Found ${data.articles.length} matching articles!`);
        } else {
          toast.error(`Selector "${containerSelector}" matched containers but found no article data. Try selecting different containers.`);
          console.log('Config that found 0 articles:', config);
        }
      } else {
        toast.error(data?.error || 'Failed to analyze pattern. The selector may not work correctly.');
        console.log('Backend error:', data);
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
    setSelectedContainers([]);
    setContainersFound(0);
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
            Click to Train - Select Article Containers
          </DialogTitle>
          <DialogDescription>
            {!showPreview 
              ? 'Click on 2 article containers to establish a pattern, then click "Analyze Pattern"'
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

          {/* Right side - container selections */}
          <div className="w-80 border rounded-lg p-4 overflow-y-auto">
            <div className="mb-3">
              <h3 className="font-medium">Container Selection</h3>
              {containersFound > 0 && !showPreview && (
                <p className="text-xs text-muted-foreground mt-1">
                  {containersFound} containers detected - click 2 to establish pattern
                </p>
              )}
            </div>
            
            {!showPreview ? (
              <div className="space-y-3">
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Selected Containers</span>
                    <Badge variant="secondary">{selectedContainers.length} / 2</Badge>
                  </div>
                  
                  {selectedContainers.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Click on article containers (outlined in blue) in the page above
                    </p>
                  )}
                  
                  {selectedContainers.map((container, idx) => (
                    <div key={idx} className="border rounded p-2 bg-muted">
                      <p className="text-xs font-mono truncate">{container.selector}</p>
                    </div>
                  ))}
                </div>
                
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {selectedContainers.length < 2 
                      ? `Select ${2 - selectedContainers.length} more container(s)`
                      : 'Ready to analyze! ✓'}
                  </div>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={handleAnalyzePattern}
                    disabled={selectedContainers.length < 2 || isAnalyzing}
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
                    <Badge variant="secondary" className="text-xs font-mono break-all">
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
