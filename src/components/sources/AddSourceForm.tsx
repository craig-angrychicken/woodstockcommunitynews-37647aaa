import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Search, XCircle } from "lucide-react";
import { ReadabilityTestResults } from "./ReadabilityTestResults";

interface AddSourceFormProps {
  onSuccess: () => void;
}

type SourceType = "RSS Feed" | "Web Page";

interface TestResult {
  success: boolean;
  title: string;
  content_preview: string;
  char_count: number;
  images: { url: string; alt: string }[];
  videos: { type: string; url: string }[];
}

export const AddSourceForm = ({ onSuccess }: AddSourceFormProps) => {
  const [sourceType, setSourceType] = useState<SourceType>("RSS Feed");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Web Page test state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const resetTestState = () => {
    setTestResult(null);
    setTestError(null);
  };

  const handleTypeChange = (value: SourceType) => {
    setSourceType(value);
    setName("");
    setUrl("");
    resetTestState();
  };

  const handleTestUrl = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL to test");
      return;
    }

    setIsTesting(true);
    resetTestState();

    try {
      const { data, error } = await supabase.functions.invoke("test-readability", {
        body: { url: url.trim() },
      });

      if (error) throw error;

      if (data.success) {
        setTestResult(data);
        // Pre-fill name with extracted title
        if (data.title && !name.trim()) {
          setName(data.title);
        }
        toast.success("URL tested successfully");
      } else {
        setTestError(data.error || "Readability extraction failed");
        toast.error(data.error || "Could not extract content from this URL");
      }
    } catch (error) {
      console.error("Test error:", error);
      const message = error instanceof Error ? error.message : "Failed to test URL";
      setTestError(message);
      toast.error(message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !url.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (sourceType === "Web Page" && !testResult?.success) {
      toast.error("Please test the URL successfully before adding");
      return;
    }

    setIsSubmitting(true);
    try {
      const config =
        sourceType === "RSS Feed"
          ? {
              feedType: "rss",
              fieldMappings: {
                titleField: "title",
                linkField: "link",
                dateField: "pubDate",
                contentField: "description",
                imageField: "enclosure.url",
              },
            }
          : {
              feedType: "web_page",
              extractImages: true,
              extractVideo: true,
            };

      const { error } = await supabase.from("sources").insert({
        name: name.trim(),
        url: url.trim(),
        type: sourceType,
        status: "testing",
        items_fetched: 0,
        parser_config: config,
      });

      if (error) throw error;

      toast.success(`${sourceType} source added to test queue successfully`);
      setName("");
      setUrl("");
      resetTestState();
      onSuccess();
    } catch (error) {
      console.error("Error adding source:", error);
      toast.error("Failed to add source");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add New Source</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Source Type Selector */}
          <div className="space-y-2">
            <Label>Source Type</Label>
            <RadioGroup
              value={sourceType}
              onValueChange={(v) => handleTypeChange(v as SourceType)}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="RSS Feed" id="type-rss" />
                <Label htmlFor="type-rss" className="cursor-pointer">
                  RSS Feed
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="Web Page" id="type-web" />
                <Label htmlFor="type-web" className="cursor-pointer">
                  Web Page
                </Label>
              </div>
            </RadioGroup>
          </div>

          {sourceType === "RSS Feed" ? (
            /* ── RSS Feed Form ── */
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Source Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., City Hall Press Releases"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">RSS Feed URL *</Label>
                  <Input
                    id="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/feed.xml"
                    type="url"
                    required
                  />
                  <div className="text-sm text-muted-foreground">
                    Enter the full URL to your RSS or Atom feed
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Adding..." : "Add RSS Source to Test Queue"}
                </Button>
              </div>
            </>
          ) : (
            /* ── Web Page Form ── */
            <>
              <div className="space-y-2">
                <Label htmlFor="web-url">Web Page URL *</Label>
                <div className="flex gap-2">
                  <Input
                    id="web-url"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      resetTestState();
                    }}
                    placeholder="https://example.com/news/article"
                    type="url"
                    className="flex-1"
                    required
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleTestUrl}
                    disabled={isTesting || !url.trim()}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Test URL
                      </>
                    )}
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  Enter a URL and test it with Readability to see extracted content, images, and videos
                </div>
              </div>

              {/* Test Error */}
              {testError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {testError}
                </div>
              )}

              {/* Test Results */}
              {testResult && <ReadabilityTestResults result={testResult} />}

              {/* Name + Submit — only after successful test */}
              {testResult?.success && (
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="web-name">Source Name *</Label>
                    <Input
                      id="web-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., City of Woodstock News"
                      required
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Adding..." : "Add Web Page Source to Test Queue"}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </form>
      </CardContent>
    </Card>
  );
};
