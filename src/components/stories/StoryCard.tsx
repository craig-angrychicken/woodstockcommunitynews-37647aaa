import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Eye, Edit, Trash2, CheckCircle, XCircle } from "lucide-react";

const sanitizeImageUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    // Decode HTML entities (e.g., &amp; -> &)
    let decoded = url
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    
    // Decode any double-encoded URLs (%2520 -> %20)
    decoded = decoded.replace(/%25([0-9A-F]{2})/gi, '%$1');
    
    return decoded;
  } catch {
    return url;
  }
};

interface StoryCardProps {
  story: {
    id: string;
    title: string;
    status: string;
    is_test: boolean;
    article_type: string;
    prompt_version_id: string | null;
    created_at: string;
    environment: string;
    ghost_url?: string | null;
    hero_image_url?: string | null;
  };
  sourceCount: number;
  onView: () => void;
  onEdit: () => void;
  onPublish: () => void;
  onReject: () => void;
  onDelete: () => void;
}

export const StoryCard = ({ story, sourceCount, onView, onEdit, onPublish, onReject, onDelete }: StoryCardProps) => {
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500",
    published: "bg-green-500",
    rejected: "bg-red-500",
    draft: "bg-gray-500",
    archived: "bg-gray-400"
  };

  return (
    <Card className="hover:border-primary transition-all">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className={`h-2 w-2 rounded-full ${statusColors[story.status]}`} />
            <Badge variant="outline" className="capitalize">
              {story.status}
            </Badge>
            {story.is_test && (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                🧪 TEST
              </Badge>
            )}
          </div>
        </div>
        <h3 className="text-lg font-semibold line-clamp-2 mt-2">{story.title}</h3>
        
        {story.hero_image_url && (
          <div className="mt-3">
            <img 
              src={sanitizeImageUrl(story.hero_image_url) || ''} 
              alt={story.title}
              referrerPolicy="no-referrer"
              className="w-full h-32 object-cover rounded-md"
            />
          </div>
        )}
      </CardHeader>
      
      <CardContent className="pb-3">
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Date:</span>
            <span className="font-medium">{new Date(story.created_at).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Sources:</span>
            <span className="font-medium">{sourceCount}</span>
          </div>
          <div className="flex justify-between">
            <span>Type:</span>
            <span className="font-medium capitalize">{story.article_type}</span>
          </div>
          {story.prompt_version_id && (
            <div className="flex justify-between">
              <span>Prompt:</span>
              <span className="font-medium text-xs truncate max-w-[150px]">
                {story.prompt_version_id}
              </span>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="flex gap-2 pt-3 border-t">
        <Button variant="outline" size="sm" onClick={onView} className="flex-1">
          <Eye className="h-4 w-4 mr-1" />
          View
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Edit className="h-4 w-4" />
        </Button>
        {(story.status === 'pending' || story.status === 'published') && (
          <Button variant="default" size="sm" onClick={onPublish} title={story.ghost_url ? 'Update on Ghost' : 'Publish to Ghost'}>
            <CheckCircle className="h-4 w-4" />
          </Button>
        )}
        {story.status !== 'rejected' && (
          <Button variant="outline" size="sm" onClick={onReject} title="Reject story" className="text-orange-600 hover:text-orange-700">
            <XCircle className="h-4 w-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  );
};
