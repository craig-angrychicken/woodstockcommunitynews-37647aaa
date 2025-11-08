import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface AddSourceFormProps {
  onSuccess: () => void;
}

export const AddSourceForm = ({ onSuccess }: AddSourceFormProps) => {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      });

      if (error) throw error;

      toast.success("Source added to test queue successfully");
      setName("");
      setUrl("");
      setType("");
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
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/feed"
                type="url"
              />
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
      </CardContent>
    </Card>
  );
};
