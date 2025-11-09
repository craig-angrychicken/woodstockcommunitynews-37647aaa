import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface GhostPostData {
  title: string;
  html: string;
  status?: "draft" | "published";
  tags?: string[];
  featured?: boolean;
  custom_excerpt?: string;
}

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

/**
 * Configuration for Ghost Admin API (to be implemented)
 * You'll need to add these as Supabase secrets:
 * - GHOST_ADMIN_API_KEY
 * - GHOST_API_URL (e.g., https://your-site.ghost.io)
 * - GHOST_API_VERSION (e.g., v5.0)
 */

// Uncomment and implement when you have Ghost API credentials:
/*
import jwt from 'jsonwebtoken';

const GHOST_API_URL = import.meta.env.VITE_GHOST_API_URL;
const GHOST_ADMIN_API_KEY = import.meta.env.VITE_GHOST_ADMIN_API_KEY;

function generateGhostToken() {
  const [id, secret] = GHOST_ADMIN_API_KEY.split(':');
  const token = jwt.sign({}, Buffer.from(secret, 'hex'), {
    keyid: id,
    algorithm: 'HS256',
    expiresIn: '5m',
    audience: '/admin/',
  });
  return token;
}

export async function publishToGhost(
  storyContent: string,
  storyTitle: string,
  options?: {
    status?: "draft" | "published";
    tags?: string[];
    featured?: boolean;
    excerpt?: string;
  }
): Promise<{ success: boolean; postId?: string; url?: string }> {
  const token = generateGhostToken();
  
  const postData: GhostPostData = {
    title: storyTitle,
    html: storyContent,
    status: options?.status || "draft",
    tags: options?.tags,
    featured: options?.featured || false,
    custom_excerpt: options?.excerpt,
  };

  const response = await fetch(`${GHOST_API_URL}/ghost/api/admin/posts/`, {
    method: 'POST',
    headers: {
      'Authorization': `Ghost ${token}`,
      'Content-Type': 'application/json',
      'Accept-Version': 'v5.0',
    },
    body: JSON.stringify({ posts: [postData] }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('Ghost API error:', error);
    toast.error('Failed to publish to Ghost');
    throw new Error(`Ghost API error: ${error.errors?.[0]?.message || response.statusText}`);
  }

  const result = await response.json();
  const post = result.posts[0];

  toast.success('Story published to Ghost successfully!');

  return {
    success: true,
    postId: post.id,
    url: post.url,
  };
}
*/
