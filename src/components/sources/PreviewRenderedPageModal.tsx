import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Copy, Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface PreviewRenderedPageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  containerSelector: string;
}

export function PreviewRenderedPageModal({
  open,
  onOpenChange,
  url,
  containerSelector,
}: PreviewRenderedPageModalProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [selectorInput, setSelectorInput] = useState(containerSelector);
  const [matchCount, setMatchCount] = useState(0);
  const [highlightEnabled, setHighlightEnabled] = useState(false);
  const [iframes, setIframes] = useState<string[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && url) {
      fetchRenderedPage();
    }
  }, [open, url]);

  useEffect(() => {
    setSelectorInput(containerSelector);
  }, [containerSelector]);

  const fetchRenderedPage = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("proxy-page", {
        body: { url },
      });

      if (error) throw error;
      setHtml(data);
    } catch (error) {
      console.error("Error fetching rendered page:", error);
      toast({
        title: "Error",
        description: "Failed to fetch rendered page",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const checkSelector = () => {
    if (!iframeRef.current?.contentDocument) return;

    const doc = iframeRef.current.contentDocument;
    
    // Remove previous highlights
    doc.querySelectorAll('[data-lovable-highlight]').forEach(el => {
      (el as HTMLElement).style.outline = '';
      el.removeAttribute('data-lovable-highlight');
    });

    try {
      const matches = doc.querySelectorAll(selectorInput);
      setMatchCount(matches.length);

      // Find iframes
      const iframeElements = doc.querySelectorAll('iframe');
      const iframeSrcs = Array.from(iframeElements)
        .slice(0, 3)
        .map(iframe => iframe.src || '(no src)')
        .filter(src => src !== '(no src)');
      setIframes(iframeSrcs);

      // Highlight if enabled
      if (highlightEnabled) {
        matches.forEach(el => {
          (el as HTMLElement).style.outline = '2px solid #22c55e';
          el.setAttribute('data-lovable-highlight', 'true');
        });
      }
    } catch (error) {
      console.error("Invalid selector:", error);
      setMatchCount(0);
      setIframes([]);
    }
  };

  useEffect(() => {
    if (html && iframeRef.current) {
      // Wait for iframe to load
      const timeout = setTimeout(() => {
        checkSelector();
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [html, selectorInput, highlightEnabled]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(html);
    toast({
      title: "Copied",
      description: "HTML copied to clipboard",
    });
  };

  const downloadHtml = () => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rendered-page.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview Rendered Page</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="render" className="flex-1 flex flex-col">
            <TabsList>
              <TabsTrigger value="render">Render</TabsTrigger>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="selector">Selector Check</TabsTrigger>
            </TabsList>

            <TabsContent value="render" className="flex-1 mt-4">
              <iframe
                ref={iframeRef}
                srcDoc={html}
                sandbox="allow-same-origin"
                className="w-full h-full border rounded"
              />
            </TabsContent>

            <TabsContent value="html" className="flex-1 mt-4 flex flex-col gap-2">
              <div className="flex gap-2">
                <Button onClick={copyToClipboard} variant="outline" size="sm">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy
                </Button>
                <Button onClick={downloadHtml} variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
              <pre className="flex-1 overflow-auto bg-muted p-4 rounded text-xs">
                {html}
              </pre>
            </TabsContent>

            <TabsContent value="selector" className="flex-1 mt-4 flex flex-col gap-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="selector">Container Selector</Label>
                  <Input
                    id="selector"
                    value={selectorInput}
                    onChange={(e) => setSelectorInput(e.target.value)}
                    placeholder=".news-list-item"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={highlightEnabled}
                      onCheckedChange={setHighlightEnabled}
                    />
                    <Label>Highlight matches</Label>
                  </div>
                  <Button onClick={checkSelector} size="sm">
                    Check Selector
                  </Button>
                </div>

                <div className="p-4 bg-muted rounded">
                  <p className="text-sm font-medium">
                    Matches found: <span className="text-primary">{matchCount}</span>
                  </p>
                  {iframes.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium">Iframes detected:</p>
                      <ul className="text-xs mt-1 space-y-1">
                        {iframes.map((src, i) => (
                          <li key={i} className="truncate text-muted-foreground">
                            {src}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 border rounded">
                <iframe
                  ref={iframeRef}
                  srcDoc={html}
                  sandbox="allow-same-origin"
                  className="w-full h-full"
                />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
