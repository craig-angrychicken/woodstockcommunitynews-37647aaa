import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AddSourceFormProps {
  onSuccess: () => void;
}

export const AddSourceForm = ({ onSuccess }: AddSourceFormProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !url.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);
    try {
      // Standard RSS feed parser config
      const config = {
        feedType: "rss",
        fieldMappings: {
          titleField: "title",
          linkField: "link",
          dateField: "pubDate",
          contentField: "description",
          imageField: "enclosure.url"
        }
      };

      const { error } = await supabase.from("sources").insert({
        name: name.trim(),
        url: url.trim(),
        type: "RSS Feed",
        status: "testing",
        items_fetched: 0,
        parser_config: config,
      });

      if (error) throw error;

      toast.success("RSS source added to test queue successfully");
      setName("");
      setUrl("");
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
        </form>
      </CardContent>
    </Card>
  );
};
