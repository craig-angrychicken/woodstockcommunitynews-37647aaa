import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SourceAnalysisModal } from "./SourceAnalysisModal";
import { FlaskConical } from "lucide-react";

interface EditSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    id: string;
    name: string;
    url?: string;
    type: string;
  };
  onSuccess: () => void;
}

export const EditSourceModal = ({ open, onOpenChange, source, onSuccess }: EditSourceModalProps) => {
  const [name, setName] = useState(source.name);
  const [url, setUrl] = useState(source.url || "");
  const [type, setType] = useState(source.type);
  const [isSaving, setIsSaving] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!url.trim()) {
      toast.error("Please enter a URL first");
      return;
    }

    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^(URL:\s*|url:\s*)/i, '');

    setIsAnalyzing(true);
    setShowAnalysisModal(true);

    try {
      const { data, error } = await supabase.functions.invoke('analyze-source', {
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

  const handleSaveConfig = async (config: any) => {
    try {
      const parserConfig = {
        scrapeConfig: config.suggestedSelectors,
        confidence: config.confidence
      };

      const { error } = await supabase
        .from('sources')
        .update({ parser_config: parserConfig })
        .eq('id', source.id);

      if (error) throw error;

      toast.success("Configuration saved successfully!");
      setShowAnalysisModal(false);
      onSuccess();
    } catch (error) {
      console.error("Error saving config:", error);
      toast.error("Failed to save configuration");
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !type) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("sources")
        .update({
          name: name.trim(),
          url: url.trim() || null,
          type,
          updated_at: new Date().toISOString(),
        })
        .eq("id", source.id);

      if (error) throw error;

      toast.success("Source updated successfully");
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating source:", error);
      toast.error("Failed to update source");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Source</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Source Name *</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., City Hall Press Releases"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-url">URL</Label>
            <div className="flex gap-2">
              <Input
                id="edit-url"
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
                Re-analyze
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-type">Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="edit-type">
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>

        <SourceAnalysisModal
          open={showAnalysisModal}
          onOpenChange={setShowAnalysisModal}
          analysisResult={analysisResult}
          isAnalyzing={isAnalyzing}
          onSaveConfig={handleSaveConfig}
        />
      </DialogContent>
    </Dialog>
  );
};
