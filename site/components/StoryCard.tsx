import Link from "next/link";
import Image from "next/image";
import { formatDate, getExcerpt } from "@/lib/formatting";

interface StoryCardProps {
  slug: string;
  title: string;
  content: string | null;
  heroImageUrl: string | null;
  publishedAt: string;
  structuredMetadata: {
    subhead?: string;
    byline?: string;
  } | null;
}

export default function StoryCard({
  slug,
  title,
  content,
  heroImageUrl,
  publishedAt,
  structuredMetadata,
}: StoryCardProps) {
  const excerpt = getExcerpt(content, structuredMetadata?.subhead);
  const byline = structuredMetadata?.byline || "Woodstock Community News";

  return (
    <article className="group">
      <Link href={`/${slug}`} className="block">
        {heroImageUrl && (
          <div className="relative aspect-[3/2] overflow-hidden rounded-lg mb-3">
            <Image
              src={heroImageUrl}
              alt={title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-300"
            />
          </div>
        )}
        <h3 className="font-serif text-lg font-bold text-gray-900 group-hover:text-gray-600 transition-colors leading-snug">
          {title}
        </h3>
        {excerpt && (
          <p className="mt-1.5 text-sm text-gray-600 leading-relaxed line-clamp-2">
            {excerpt}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-400">
          <span>{byline}</span>
          <span className="mx-1">&middot;</span>
          <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
        </p>
      </Link>
    </article>
  );
}
