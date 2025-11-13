import { useState, useEffect, useRef } from "react";
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
  const [selectedImages, setSelectedImages] = useState<Array<{selector: string, imageUrl: string}>>([]);
  const [containersFound, setContainersFound] = useState(0);
  const snapshotResolverRef = useRef<((html: string) => void) | null>(null);
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

  // Helper to get live HTML snapshot from iframe (best-effort)
  const getIframeHtmlSnapshot = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const iframe = document.getElementById('selector-iframe') as HTMLIFrameElement;
      if (!iframe?.contentWindow) {
        return reject(new Error('Iframe not ready'));
      }

      // Store resolver in ref to avoid race conditions
      snapshotResolverRef.current = resolve;
      
      // Send request
      console.log('📸 Requesting HTML snapshot from iframe...');
      iframe.contentWindow.postMessage({ type: 'REQUEST_HTML_SNAPSHOT' }, '*');

      // Timeout after 8 seconds (increased from 3s)
      setTimeout(() => {
        snapshotResolverRef.current = null;
        reject(new Error('HTML snapshot timed out'));
      }, 8000);
    });
  };

  // Analyze containers locally from iframe matches
  const analyzeContainersLocally = (matches: { html: string }[], containerSelector: string, imageSelector?: string) => {
    setIsAnalyzing(true);
    
    try {
      const parser = new DOMParser();
      const articles: any[] = [];
      
      // Extract article data from each match
      matches.forEach(match => {
        const doc = parser.parseFromString(match.html, 'text/html');
        const container = doc.body.firstElementChild;
        
        if (!container) return;
        
        // Extract link - filter out invalid URLs
        const linkEl = container.querySelector('a[href]');
        let href = linkEl?.getAttribute('href') || linkEl?.getAttribute('data-original-href') || '';
        
        // Skip if URL is just a hash anchor or empty
        if (href === '#' || href === '' || href === 'javascript:void(0)') {
          href = '';
        }
        
        // Extract title (prioritize headings or elements with "title" in class)
        const titleEl = container.querySelector('h1, h2, h3, h4, h5, h6, [class*="title"], [class*="headline"]');
        const title = titleEl?.textContent?.trim() || linkEl?.textContent?.trim() || '';
        
        if (!title || title.length < 5) return; // Skip if no valid title
        
        // Extract images using the detected imageSelector if provided
        const images: string[] = [];
        
        if (imageSelector) {
          const imageEls = container.querySelectorAll(imageSelector);
          imageEls.forEach(img => {
            // Check for img[src], data-src, or background-image
            const src = img.getAttribute('src') || 
                        img.getAttribute('data-src') || 
                        img.getAttribute('data-lazy-src');
            
            if (src && !src.startsWith('data:') && src !== '#') {
              images.push(src);
            } else {
              // Check background-image in style
              const style = img.getAttribute('style') || '';
              const match = style.match(/url\(['"]?([^'"]+)['"]?\)/);
              if (match && match[1]) {
                images.push(match[1]);
              }
            }
          });
        } else {
          // Fallback: try img tags first, then background images
          const imgEls = container.querySelectorAll('img');
          imgEls.forEach(img => {
            const src = img.getAttribute('src') || 
                        img.getAttribute('data-src') || 
                        img.getAttribute('data-lazy-src');
            if (src && !src.startsWith('data:') && src !== '#') {
              images.push(src);
            }
          });
          
          if (images.length === 0) {
            const bgEls = container.querySelectorAll('[style*="background"]');
            bgEls.forEach(el => {
              const style = el.getAttribute('style') || '';
              const match = style.match(/url\(['"]?([^'"]+)['"]?\)/);
              if (match && match[1]) {
                images.push(match[1]);
              }
            });
          }
        }
        
        // Extract excerpt - clone container and remove date elements to avoid duplication
        const containerClone = container.cloneNode(true) as Element;
        const dateElements = containerClone.querySelectorAll('[class*="date"], [class*="time"], time');
        dateElements.forEach(el => el.remove());
        
        const excerptEl = containerClone.querySelector('p, [class*="excerpt"], [class*="description"]');
        const excerpt = (excerptEl?.textContent?.trim() || containerClone.textContent?.trim() || '')
          .replace(/\s+/g, ' ')  // Normalize whitespace
          .substring(0, 200);
        
        // Try to extract date
        const dateEl = container.querySelector('[class*="date"], [class*="time"], time');
        const dateText = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || null;
        
        articles.push({
          title,
          url: href,
          excerpt,
          images,
          date: dateText
        });
      });
      
      console.log(`✅ Extracted ${articles.length} articles from ${matches.length} containers`);
      
      // Build detected config
      const config = {
        containerSelector,
        linkSelector: 'a[href]',
        imageSelector: imageSelector || 'img[src]', // Use detected or fallback
        titleSelector: 'h1, h2, h3, h4, h5, h6, [class*="title"]',
        dateSelector: '[class*="date"], [class*="time"], time',
        contentSelector: 'p, [class*="excerpt"], [class*="description"]'
      };
      
      setDetectedConfig(config);
      setPreviewArticles(articles);
      setShowPreview(true);
      
      toast.success(`Found ${articles.length} matching articles!`);
    } catch (error) {
      console.error('Failed to analyze matches:', error);
      toast.error('Failed to analyze pattern. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Listen for container selections from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'CONTAINER_SELECTED') {
        const { selector, html, isSelected, totalSelected } = event.data;
        
        console.log('Container selection event:', {
          selector,
          isSelected,
          totalSelected,
          htmlLength: html?.length
        });

        setSelectedContainers(prev => {
          const newContainers = isSelected
            ? [...prev, { selector, html }]
            : prev.filter(c => c.selector !== selector);
          
          // Don't auto-detect yet - wait for image selection
          return newContainers;
        });
      } else if (event.data.type === 'IMAGE_SELECTED') {
        const { selector, imageUrl, isSelected } = event.data;
        
        console.log('Image selection event:', {
          selector,
          isSelected,
          imageUrl
        });
        
        setSelectedImages(prev => {
          const newImages = isSelected
            ? [...prev, { selector, imageUrl }]
            : prev.filter(img => img.selector !== selector);
          
          // Auto-trigger FULL pattern detection when 2 images selected
          if (newImages.length === 2 && selectedContainers.length === 2) {
            const containerSelector = selectedContainers[0].selector;
            const imageSelector = newImages[0].selector;
            
            console.log('🎯 Auto-detecting pattern with:', {
              containerSelector,
              imageSelector
            });
            
            // Send message to iframe to find all matching containers
            const iframe = document.getElementById('selector-iframe') as HTMLIFrameElement;
            if (iframe?.contentWindow) {
              iframe.contentWindow.postMessage({
                type: 'FIND_ALL_MATCHES',
                selector: containerSelector,
                imageSelector: imageSelector
              }, '*');
            }
          }
          
          return newImages;
        });
      } else if (event.data.type === 'HANDLER_READY') {
        const { containersFound: count } = event.data;
        console.log(`✅ Click handler ready, detected ${count} containers`);
        setContainersFound(count);
      } else if (event.data.type === 'HTML_SNAPSHOT') {
        console.log('✅ Received HTML_SNAPSHOT from iframe, length:', event.data.html?.length);
        if (snapshotResolverRef.current) {
          snapshotResolverRef.current(event.data.html);
          snapshotResolverRef.current = null;
        }
      } else if (event.data.type === 'ALL_MATCHES_FOUND') {
        const { selector, imageSelector, matches, count } = event.data;
        console.log(`✅ Found ${count} matching articles for selector: ${selector}`);
        
        // Analyze matches locally with both selectors
        analyzeContainersLocally(matches, selector, imageSelector);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectedContainers.length]);

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

      // Collect container HTML for backend processing
      const containersHtml = selectedContainers.map(c => c.html);
      console.log(`📦 Analyzing ${containersHtml.length} selected containers (no snapshot required)...`);

      // Get live HTML snapshot from iframe as best-effort (for future features)
      let snapshotHtml = renderedHtml;
      try {
        console.log('📸 Requesting live HTML snapshot from iframe (best-effort)...');
        snapshotHtml = await getIframeHtmlSnapshot();
        console.log('✅ Got live HTML snapshot, length:', snapshotHtml.length);
      } catch (error) {
        console.warn('⚠️ Snapshot unavailable, will use selected containers directly:', error);
      }

      // Skip local validation - let backend process the selected containers directly
      const { data, error } = await supabase.functions.invoke('test-scrape-config', {
        body: {
          sourceUrl,
          config,
          html: snapshotHtml,
          containersHtml  // Pass selected container HTML directly
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
    setSelectedImages([]);
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
            {!showPreview ? (
              selectedContainers.length === 0 
                ? 'Step 1-2: Click 2 article containers to start'
                : selectedContainers.length === 1
                  ? 'Step 2: Click 1 more container'
                  : selectedImages.length === 0
                    ? 'Step 3-4: Now click 2 images within articles'
                    : selectedImages.length === 1
                      ? 'Step 4: Click 1 more image'
                      : 'Detecting pattern...'
            ) : `Found ${previewArticles.length} articles - review and save when ready`}
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
                  sandbox="allow-scripts allow-same-origin"
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
                    {article.url && article.url !== '#' && (
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
                
                <div className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Selected Images</span>
                    <Badge variant="secondary">{selectedImages.length} / 2</Badge>
                  </div>
                  
                  {selectedContainers.length < 2 && (
                    <p className="text-xs text-muted-foreground">
                      Select 2 containers first
                    </p>
                  )}
                  
                  {selectedContainers.length === 2 && selectedImages.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Now click on 2 images within the articles
                    </p>
                  )}
                  
                  {selectedImages.map((image, idx) => (
                    <div key={idx} className="border rounded p-2 bg-muted">
                      <p className="text-xs font-mono truncate">{image.selector}</p>
                    </div>
                  ))}
                </div>
                
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {selectedContainers.length < 2 
                      ? `Select ${2 - selectedContainers.length} more container(s)`
                      : selectedImages.length < 2
                        ? `Select ${2 - selectedImages.length} more image(s)`
                        : isAnalyzing 
                          ? 'Detecting pattern...'
                          : 'Pattern will auto-detect ✓'}
                  </div>
                  {isAnalyzing && (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Analyzing...</span>
                    </div>
                  )}
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
