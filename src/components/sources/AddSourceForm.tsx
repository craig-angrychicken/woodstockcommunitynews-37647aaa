import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SourceAnalysisModalV2 } from "./SourceAnalysisModalV2";
import { FlaskConical } from "lucide-react";

interface AddSourceFormProps {
  onSuccess: () => void;
}

export const AddSourceForm = ({ onSuccess }: AddSourceFormProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [parserConfig, setParserConfig] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL first");
      return;
    }

    // Clean the URL - remove common prefixes that users might type
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(URL:\s*|url:\s*)/i, '');
    
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      toast.error("Please enter a valid URL starting with http:// or https://");
      return;
    }

    setIsAnalyzing(true);
    setShowAnalysisModal(true);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-source-v2', {
        body: { sourceUrl: cleanUrl }
      });

      if (error) throw error;

      setAnalysisResult(data);
      
      if (data.success) {
        toast.success("Analysis complete!");
      } else {
        toast.error(data.error || "Analysis failed");
      }
    } catch (error) {
      console.error("Error analyzing source:", error);
      toast.error("Failed to analyze source");
      setAnalysisResult({ success: false, error: "Failed to analyze source" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveConfig = (config: any) => {
    // Store the complete scrape configuration
    setParserConfig({
      scrapeConfig: config.suggestedConfig,
      confidence: config.confidence,
      diagnostics: config.diagnostics
    });
    toast.success("Configuration saved! You can now add the source.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !type) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("sources").insert({
        name: name.trim(),
        url: url.trim() || null,
        type,
        status: "testing",
        items_fetched: 0,
        parser_config: parserConfig,
      });

      if (error) throw error;

      toast.success("Source added to test queue successfully");
      setName("");
      setUrl("");
      setType("");
      setParserConfig(null);
      setAnalysisResult(null);
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
              <Label htmlFor="url">URL</Label>
              <div className="flex gap-2">
                <Input
                  id="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/feed"
                  type="url"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleAnalyze}
                  disabled={!url.trim() || isAnalyzing}
                >
                  <FlaskConical className="h-4 w-4 mr-2" />
                  Analyze
                </Button>
              </div>
              {parserConfig && (
                <div className="text-sm text-green-600 dark:text-green-400">
                  ✓ Configuration ready (confidence: {parserConfig.confidence}%)
                </div>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">Type *</Label>
            <Select value={type} onValueChange={setType} required>
              <SelectTrigger id="type">
                <SelectValue placeholder="Select source type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Government">Government</SelectItem>
                <SelectItem value="Schools">Schools</SelectItem>
                <SelectItem value="Safety">Safety</SelectItem>
                <SelectItem value="Business">Business</SelectItem>
                <SelectItem value="Community">Community</SelectItem>
                <SelectItem value="Events">Events</SelectItem>
                <SelectItem value="Other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding..." : "Add to Test Queue"}
            </Button>
          </div>
        </form>

        <SourceAnalysisModalV2
          open={showAnalysisModal}
          onOpenChange={setShowAnalysisModal}
          analysisResult={analysisResult}
          isAnalyzing={isAnalyzing}
          onSaveConfig={handleSaveConfig}
          sourceUrl={url}
        />
      </CardContent>
    </Card>
  );
};
