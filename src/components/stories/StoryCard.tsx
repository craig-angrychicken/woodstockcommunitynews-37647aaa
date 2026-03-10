import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Eye, Edit, Trash2, CheckCircle, XCircle } from "lucide-react";
import { sanitizeImageUrl } from "@/lib/image-utils";

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
    featured?: boolean;
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
            {story.featured && (
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                Featured
              </Badge>
            )}
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

      <CardFooter className="flex flex-col gap-2 pt-3 border-t">
        <div className="flex gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onView} className="flex-1">
            <Eye className="h-4 w-4 mr-1" />
            View
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
            <Edit className="h-4 w-4 mr-1" />
            Edit
          </Button>
          {(story.status === 'pending' || story.status === 'published') && (
            <Button variant="default" size="sm" onClick={onPublish} className="flex-1">
              <CheckCircle className="h-4 w-4 mr-1" />
              Publish
            </Button>
          )}
        </div>
        <div className="flex gap-2 w-full">
          {story.status !== 'rejected' && (
            <Button variant="outline" size="sm" onClick={onReject} className="flex-1 text-orange-600 hover:text-orange-700">
              <XCircle className="h-4 w-4 mr-1" />
              Reject
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onDelete} className="flex-1 text-destructive hover:text-destructive">
            <Trash2 className="h-4 w-4 mr-1" />
            Delete
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
};
