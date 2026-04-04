import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Publishes a story to the public site via the publish-story edge function.
 * Handles slug generation, status update, revalidation, and Facebook posting.
 */
export async function publishStory(
  storyId: string,
  featured: boolean
): Promise<{ success: boolean; url?: string }> {
  try {
    console.log("Publishing story:", storyId);

    const { data, error } = await supabase.functions.invoke('publish-story', {
      body: { storyId, featured },
    });

    if (error) {
      console.error("Publish error:", error);
      toast.error("Failed to publish story");
      throw error;
    }

    if (!data.success) {
      console.error("Publish error:", data.error);
      toast.error(`Failed to publish: ${data.error}`);
      return { success: false };
    }

    return {
      success: true,
      url: data.url,
    };
  } catch (error) {
    console.error("Error publishing story:", error);
    toast.error("Failed to publish story");
    return { success: false };
  }
}

// Keep backward-compatible export name
export const publishToGhost = publishStory;
