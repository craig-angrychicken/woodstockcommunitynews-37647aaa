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
}

type SelectionStep = 'container' | 'title' | 'link' | 'date' | 'content' | 'image' | 'preview';

const stepDescriptions = {
  container: 'Click on one article item in the list',
  title: 'Click on the title/heading of an article',
  link: 'Click on a link to the full article',
  date: 'Click on the publish date (optional - click Skip if not visible)',
  content: 'Click on article summary/description (optional)',
  image: 'Click on article image (optional)',
  preview: 'Review your selections'
};

export function InteractiveSelectorModal({
  open,
  onOpenChange,
  sourceUrl,
  onConfigSelected
}: InteractiveSelectorModalProps) {
  const [step, setStep] = useState<SelectionStep>('container');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedElements, setSelectedElements] = useState<{
    container?: string;
    title?: string;
    link?: string;
    date?: string;
    content?: string;
    image?: string;
  }>({});
  const [previewArticles, setPreviewArticles] = useState<any[]>([]);
  const [iframeKey, setIframeKey] = useState(0);
  const [proxiedUrl, setProxiedUrl] = useState<string>('');
  const [isLoadingProxy, setIsLoadingProxy] = useState(false);

  // Load proxied page when modal opens
  const loadProxiedPage = async () => {
    setIsLoadingProxy(true);
    try {
      const { data, error } = await supabase.functions.invoke('proxy-page', {
        body: { url: sourceUrl }
      });

      if (error) throw error;

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
        toast.success('Page ready for selection');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleElementSelected = (selector: string) => {
    setSelectedElements(prev => ({
      ...prev,
      [step]: selector
    }));

    // Move to next step
    const steps: SelectionStep[] = ['container', 'title', 'link', 'date', 'content', 'image', 'preview'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleSkip = () => {
    const steps: SelectionStep[] = ['container', 'title', 'link', 'date', 'content', 'image', 'preview'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const handleBack = () => {
    const steps: SelectionStep[] = ['container', 'title', 'link', 'date', 'content', 'image', 'preview'];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  const handleTestConfig = async () => {
    if (!selectedElements.container) {
      toast.error('Container selector is required');
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('scrape-articles', {
        body: {
          sourceUrl,
          config: {
            containerSelector: selectedElements.container,
            titleSelector: selectedElements.title || 'h3',
            dateSelector: selectedElements.date || 'time',
            linkSelector: selectedElements.link || 'a[href]',
            contentSelector: selectedElements.content || 'p',
            imageSelector: selectedElements.image || 'img[src]',
            timeout: 30000
          }
        }
      });

      if (error) throw error;

      setPreviewArticles(data.articles || []);
      toast.success(`Found ${data.articles?.length || 0} articles`);
    } catch (error) {
      console.error('Test failed:', error);
      toast.error('Failed to test configuration');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = () => {
    const config = {
      containerSelector: selectedElements.container,
      titleSelector: selectedElements.title || 'h3',
      dateSelector: selectedElements.date || 'time',
      linkSelector: selectedElements.link || 'a[href]',
      contentSelector: selectedElements.content || 'p',
      imageSelector: selectedElements.image || 'img[src]',
      timeout: 30000
    };
    onConfigSelected(config);
    onOpenChange(false);
  };

  const handleReset = () => {
    setStep('container');
    setSelectedElements({});
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
            Interactive Selector Builder
          </DialogTitle>
          <DialogDescription>
            {step !== 'preview' 
              ? stepDescriptions[step]
              : 'Review and test your configuration'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-4 flex-1 overflow-hidden">
          {/* Left side - iframe */}
          <div className="flex-1 border rounded-lg overflow-hidden bg-muted">
            {step !== 'preview' ? (
              isLoadingProxy ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin" />
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
                <h3 className="font-medium">Preview Articles ({previewArticles.length})</h3>
                {previewArticles.length === 0 && (
                  <p className="text-sm text-muted-foreground">Click "Test Configuration" to preview</p>
                )}
                {previewArticles.slice(0, 5).map((article, idx) => (
                  <div key={idx} className="border rounded p-3 bg-background">
                    <h4 className="font-medium text-sm">{article.title || 'No title'}</h4>
                    {article.link && (
                      <a href={article.link} target="_blank" rel="noopener noreferrer" className="text-xs text-primary">
                        {article.link}
                      </a>
                    )}
                    {article.date && <p className="text-xs text-muted-foreground mt-1">{article.date}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right side - selections */}
          <div className="w-80 border rounded-lg p-4 overflow-y-auto">
            <h3 className="font-medium mb-3">Selected Elements</h3>
            <div className="space-y-2">
              {(['container', 'title', 'link', 'date', 'content', 'image'] as const).map(field => (
                <div key={field} className="flex items-center gap-2">
                  {selectedElements[field] ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium capitalize">{field}</p>
                    {selectedElements[field] && (
                      <Badge variant="secondary" className="text-xs mt-1">
                        {selectedElements[field]}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between">
          <div className="flex gap-2">
            {step !== 'container' && step !== 'preview' && (
              <Button variant="outline" onClick={handleBack}>Back</Button>
            )}
            {step !== 'container' && step !== 'preview' && !['container', 'title', 'link'].includes(step) && (
              <Button variant="ghost" onClick={handleSkip}>Skip</Button>
            )}
            {step !== 'preview' && (
              <Button variant="outline" onClick={handleReset}>Reset</Button>
            )}
          </div>
          <div className="flex gap-2">
            {step === 'preview' && (
              <>
                <Button variant="outline" onClick={handleBack}>Back to Selection</Button>
                <Button onClick={handleTestConfig} disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Test Configuration
                </Button>
                <Button onClick={handleSave} disabled={!selectedElements.container || previewArticles.length === 0}>
                  Save Configuration
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
