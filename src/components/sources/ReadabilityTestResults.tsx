import { CheckCircle, Image, Video, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ExtractedImage {
  url: string;
  alt: string;
}

interface ExtractedVideo {
  type: string;
  url: string;
}

interface TestResult {
  success: boolean;
  title: string;
  content_preview: string;
  char_count: number;
  images: ExtractedImage[];
  videos: ExtractedVideo[];
}

interface ReadabilityTestResultsProps {
  result: TestResult;
}

export const ReadabilityTestResults = ({ result }: ReadabilityTestResultsProps) => {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-5 w-5 text-green-500" />
        <span className="font-medium">Readability extraction successful</span>
        <Badge variant="secondary">{result.char_count.toLocaleString()} chars</Badge>
      </div>

      {/* Title */}
      {result.title && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Extracted Title</div>
          <div className="text-sm font-medium">{result.title}</div>
        </div>
      )}

      {/* Content Preview */}
      <div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase mb-1">
          <FileText className="h-3.5 w-3.5" />
          Content Preview
        </div>
        <div className="text-sm text-muted-foreground bg-background rounded p-3 max-h-40 overflow-y-auto">
          {result.content_preview}
        </div>
      </div>

      {/* Images */}
      <div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase mb-1">
          <Image className="h-3.5 w-3.5" />
          Images ({result.images.length})
        </div>
        {result.images.length > 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {result.images.slice(0, 8).map((img, i) => (
              <div key={i} className="relative aspect-square rounded overflow-hidden bg-background border">
                <img
                  src={img.url}
                  alt={img.alt || `Image ${i + 1}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            ))}
            {result.images.length > 8 && (
              <div className="aspect-square rounded bg-background border flex items-center justify-center text-sm text-muted-foreground">
                +{result.images.length - 8} more
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No images found</div>
        )}
      </div>

      {/* Videos */}
      <div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase mb-1">
          <Video className="h-3.5 w-3.5" />
          Videos ({result.videos.length})
        </div>
        {result.videos.length > 0 ? (
          <div className="space-y-1.5">
            {result.videos.map((video, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-background rounded p-2 border">
                <Badge variant="outline" className="text-xs">{video.type}</Badge>
                <a
                  href={video.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline truncate"
                >
                  {video.url}
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No videos found</div>
        )}
      </div>
    </div>
  );
};
