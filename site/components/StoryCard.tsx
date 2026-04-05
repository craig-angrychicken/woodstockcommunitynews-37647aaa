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
  variant?: "lead" | "row";
}

export default function StoryCard({
  slug,
  title,
  content,
  heroImageUrl,
  publishedAt,
  structuredMetadata,
  variant = "row",
}: StoryCardProps) {
  const excerpt = getExcerpt(content, structuredMetadata?.subhead);
  const byline = structuredMetadata?.byline || "Woodstock Community News";

  if (variant === "lead") {
    return (
      <article className="group pb-8 border-b border-[var(--color-rule)]">
        <Link href={`/${slug}`} className="block">
          {heroImageUrl && (
            <div className="relative h-[220px] sm:h-[280px] lg:h-[340px] overflow-hidden mb-5">
              <Image
                src={heroImageUrl}
                alt={title}
                fill
                sizes="(max-width: 1024px) 100vw, 1152px"
                className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
                priority
              />
            </div>
          )}
          <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold text-ink group-hover:text-[var(--color-accent)] transition-colors leading-[1.1] tracking-tight">
            {title}
          </h2>
          {excerpt && (
            <p className="mt-3 font-serif italic text-lg text-gray-600 leading-snug max-w-2xl">
              {excerpt}
            </p>
          )}
          <p className="mt-4 text-xs font-sans text-gray-500 tracking-wide">
            <span className="text-[var(--color-accent)] font-semibold">{byline}</span>
            <span className="mx-2 text-gray-300">|</span>
            <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
          </p>
        </Link>
      </article>
    );
  }

  return (
    <article className="group py-5 border-b border-[var(--color-rule)]">
      <Link href={`/${slug}`} className="flex gap-4 items-start">
        {heroImageUrl && (
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 overflow-hidden">
            <Image
              src={heroImageUrl}
              alt={title}
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg sm:text-xl font-semibold text-ink group-hover:text-[var(--color-accent)] transition-colors leading-snug tracking-tight">
            {title}
          </h3>
          {excerpt && (
            <p className="mt-1.5 font-serif text-[15px] text-gray-600 leading-snug line-clamp-2">
              {excerpt}
            </p>
          )}
          <p className="mt-2 text-xs font-sans text-gray-500">
            <span className="text-[var(--color-accent)] font-semibold">{byline}</span>
            <span className="mx-1.5 text-gray-300">|</span>
            <time dateTime={publishedAt}>{formatDate(publishedAt)}</time>
          </p>
        </div>
      </Link>
    </article>
  );
}
