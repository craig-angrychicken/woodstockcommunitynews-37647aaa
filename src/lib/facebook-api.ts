import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PublishToFacebookOptions {
  storyId: string;
  title: string;
  content: string;
  ghostUrl: string;
  heroImageUrl?: string | null;
}

/**
 * Extract a summary from the story content for Facebook posting.
 * Takes the first paragraph after BYLINE, or first 280 chars.
 */
function extractSummary(content: string): string {
  if (!content) return '';
  
  // Split by newlines and find content after BYLINE
  const lines = content.split('\n').filter(line => line.trim());
  
  let summaryLines: string[] = [];
  let foundByline = false;
  
  for (const line of lines) {
    if (line.startsWith('BYLINE:')) {
      foundByline = true;
      continue;
    }
    if (foundByline && !line.startsWith('SOURCE:')) {
      summaryLines.push(line);
      // Take first 2-3 paragraphs max
      if (summaryLines.length >= 2) break;
    }
  }
  
  let summary = summaryLines.join('\n\n');
  
  // If no summary found, use the whole content minus metadata
  if (!summary) {
    summary = lines
      .filter(line => !line.startsWith('SUBHEAD:') && !line.startsWith('BYLINE:') && !line.startsWith('SOURCE:'))
      .slice(0, 2)
      .join('\n\n');
  }
  
  // Truncate to ~400 chars for a good Facebook post length
  if (summary.length > 400) {
    summary = summary.substring(0, 397) + '...';
  }
  
  return summary;
}

export async function publishToFacebook(options: PublishToFacebookOptions): Promise<{ 
  success: boolean; 
  postId?: string; 
  url?: string;
  error?: string;
}> {
  const { storyId, title, content, ghostUrl, heroImageUrl } = options;

  if (!ghostUrl) {
    toast.error('Please publish to Ghost first before sharing to Facebook');
    return { success: false, error: 'Ghost URL required' };
  }

  console.log(`Publishing to Facebook: "${title}"`);
  
  const summary = extractSummary(content);
  
  try {
    const { data, error } = await supabase.functions.invoke('publish-to-facebook', {
      body: {
        storyId,
        title,
        summary,
        ghostUrl,
        heroImageUrl,
      },
    });

    if (error) {
      console.error('Facebook publish error:', error);
      toast.error(`Failed to publish to Facebook: ${error.message}`);
      return { success: false, error: error.message };
    }

    if (data?.success) {
      toast.success('Published to Facebook!', {
        description: data.url ? 'Click to view post' : undefined,
        action: data.url ? {
          label: 'View',
          onClick: () => window.open(data.url, '_blank'),
        } : undefined,
      });
      return { success: true, postId: data.postId, url: data.url };
    } else {
      const errorMsg = data?.error || 'Unknown error';
      toast.error(`Failed to publish to Facebook: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  } catch (err: any) {
    console.error('Facebook publish exception:', err);
    toast.error(`Failed to publish to Facebook: ${err.message}`);
    return { success: false, error: err.message };
  }
}
