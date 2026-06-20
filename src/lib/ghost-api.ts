import { toast } from "sonner";
import { api } from "@/lib/api";

/** Response shape from POST /api/admin/stories/:id/publish (pipeline-admin). */
interface PublishStoryResponse {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Publishes a story to the public site via the admin publish endpoint.
 * Handles slug generation, status update, revalidation, and Facebook posting.
 */
export async function publishStory(
  storyId: string,
  featured: boolean
): Promise<{ success: boolean; url?: string }> {
  try {
    console.log("Publishing story:", storyId);

    const data = await api.post<PublishStoryResponse>(
      `/stories/${storyId}/publish`,
      { featured }
    );

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
