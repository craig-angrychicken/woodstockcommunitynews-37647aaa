import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { InteractiveSelectorModal } from "./InteractiveSelectorModal";
import { MousePointer2 } from "lucide-react";

interface AddSourceFormProps {
  onSuccess: () => void;
}

export const AddSourceForm = ({ onSuccess }: AddSourceFormProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [parserConfig, setParserConfig] = useState<any>(null);

  const handleClickToTrain = () => {
    if (!url.trim()) {
      toast.error("Please enter a URL first");
      return;
    }

    // Clean the URL
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(URL:\s*|url:\s*)/i, '');
    
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      toast.error("Please enter a valid URL starting with http:// or https://");
      return;
    }

    setShowTrainingModal(true);
  };

  const handleSaveConfig = (config: any) => {
    setParserConfig({
      scrapeConfig: config,
      confidence: 100,
      diagnostics: {
        containersFound: 1,
        hasValidTitles: true,
        hasValidDates: true,
        hasValidLinks: true,
        issues: []
      }
    });
    toast.success("Configuration saved! You can now add the source.");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !type) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (type === "RSS Feed" && !url.trim()) {
      toast.error("RSS Feed sources require a URL");
      return;
    }

    setIsSubmitting(true);
    try {
      // For RSS feeds, set standard parser config
      const config = type === "RSS Feed" ? {
        feedType: "rss",
        fieldMappings: {
          titleField: "title",
          linkField: "link",
          dateField: "pubDate",
          contentField: "description",
          imageField: "enclosure.url"
        }
      } : parserConfig;

      const { error } = await supabase.from("sources").insert({
        name: name.trim(),
        url: url.trim() || null,
        type,
        status: "testing",
        items_fetched: 0,
        parser_config: config,
      });

      if (error) throw error;

      toast.success("Source added to test queue successfully");
      setName("");
      setUrl("");
      setType("");
      setParserConfig(null);
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
                  placeholder={type === "RSS Feed" ? "https://example.com/feed.xml" : "https://example.com/feed"}
                  type="url"
                  className="flex-1"
                />
                {type !== "RSS Feed" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleClickToTrain}
                    disabled={!url.trim()}
                  >
                    <MousePointer2 className="h-4 w-4 mr-2" />
                    Click to Train
                  </Button>
                )}
              </div>
              {parserConfig && type !== "RSS Feed" && (
                <div className="text-sm text-green-600 dark:text-green-400">
                  ✓ Configuration ready
                </div>
              )}
              {type === "RSS Feed" && (
                <div className="text-sm text-muted-foreground">
                  Enter the full URL to your RSS or Atom feed
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
                <SelectItem value="RSS Feed">RSS Feed</SelectItem>
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

        <InteractiveSelectorModal
          open={showTrainingModal}
          onOpenChange={setShowTrainingModal}
          sourceUrl={url}
          onConfigSelected={handleSaveConfig}
        />
      </CardContent>
    </Card>
  );
};
