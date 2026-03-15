import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Publishes a story to Ghost CMS
 * @param storyContent - The HTML content of the story
 * @param storyTitle - The title of the story
 * @param options - Additional Ghost post options
 * @returns Promise with the created post data
 */
export async function publishToGhost(
  storyContent: string,
  storyTitle: string,
  options?: {
    status?: "draft" | "published";
    tags?: string[];
    featured?: boolean;
    excerpt?: string;
    ghostUrl?: string;
    publishedAt?: string;
    heroImageUrl?: string | null;
    artifactId?: string;
  }
): Promise<{ success: boolean; postId?: string; url?: string }> {
  try {
    console.log("📝 Publishing to Ghost CMS:", storyTitle);

    const { data, error } = await supabase.functions.invoke('publish-to-ghost', {
      body: {
        title: storyTitle,
        content: storyContent,
        status: options?.status || "draft",
        tags: options?.tags,
        featured: options?.featured || false,
        excerpt: options?.excerpt,
        ghostUrl: options?.ghostUrl,
        publishedAt: options?.publishedAt,
        heroImageUrl: options?.heroImageUrl,
        artifactId: options?.artifactId,
      },
    });

    if (error) {
      console.error("Ghost API error:", error);
      toast.error("Failed to publish to Ghost");
      throw error;
    }

    if (!data.success) {
      console.error("Ghost API error:", data.error);
      toast.error(`Failed to publish to Ghost: ${data.error}`);
      return { success: false };
    }

    toast.success(options?.ghostUrl ? "Story updated on Ghost!" : "Story published to Ghost successfully!");

    return {
      success: true,
      postId: data.postId,
      url: data.url,
    };
  } catch (error) {
    console.error("Error publishing to Ghost:", error);
    toast.error("Failed to publish to Ghost");
    return { success: false };
  }
}

