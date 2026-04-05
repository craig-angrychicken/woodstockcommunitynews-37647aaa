import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import { estimateReadTime, formatDate, getExcerpt } from "@/lib/formatting";
import RelatedStories from "@/components/RelatedStories";
import ShareButtons from "@/components/ShareButtons";

export const revalidate = 3600;

interface StructuredMetadata {
  subhead?: string;
  byline?: string;
  source_name?: string;
  source_url?: string;
}

interface Story {
  id: string;
  title: string;
  content: string | null;
  slug: string;
  hero_image_url: string | null;
  published_at: string;
  content_updated_at: string | null;
  structured_metadata: StructuredMetadata | null;
  word_count: number | null;
}

type Props = {
  params: Promise<{ slug: string }>;
};

async function getStory(slug: string) {
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, content_updated_at, structured_metadata, word_count"
    )
    .eq("slug", slug)
    .eq("status", "published")
    .eq("environment", "production")
    .single();

  return data as Story | null;
}

async function getRelatedStories(currentId: string) {
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .neq("id", currentId)
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(4);

  return data || [];
}

export async function generateStaticParams() {
  const { data } = await supabase
    .from("stories")
    .select("slug")
    .eq("status", "published")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(100);

  return (data || []).map((story) => ({ slug: story.slug }));
}

export async function generateMetadata(
  { params }: Props
): Promise<Metadata> {
  const { slug } = await params;
  const story = await getStory(slug);
  if (!story) return {};

  const metadata = story.structured_metadata;
  const description = getExcerpt(story.content, metadata?.subhead);

  return {
    title: story.title,
    description,
    alternates: {
      canonical: `/${story.slug}`,
    },
    openGraph: {
      title: story.title,
      description,
      type: "article",
      url: `/${story.slug}`,
      publishedTime: story.published_at,
      authors: [metadata?.byline || "Woodstock Community News"],
      ...(story.hero_image_url ? { images: [story.hero_image_url] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: story.title,
      description,
      ...(story.hero_image_url ? { images: [story.hero_image_url] } : {}),
    },
  };
}

export default async function StoryPage({ params }: Props) {
  const { slug } = await params;
  const story = await getStory(slug);

  if (!story) notFound();

  const metadata = story.structured_metadata;
  const byline = metadata?.byline || "Woodstock Community News";
  const readTime = estimateReadTime(story.content);
  const paragraphs = (story.content || "")
    .split("\n")
    .filter((p) => p.trim());

  // Show "Updated" only when content changed meaningfully after publishing
  // (>1h after published_at, to filter immediate post-publish touchups).
  const showUpdated = (() => {
    if (!story.content_updated_at) return false;
    const published = new Date(story.published_at).getTime();
    const updated = new Date(story.content_updated_at).getTime();
    return updated - published > 60 * 60 * 1000;
  })();

  const related = await getRelatedStories(story.id);

  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink leading-[1.1] tracking-tight">
          {story.title}
        </h1>
        {metadata?.subhead && (
          <p className="mt-4 font-serif italic text-xl text-gray-600 leading-snug">
            {metadata.subhead}
          </p>
        )}
        <p className="mt-6 text-sm font-sans text-gray-500">
          <span className="text-[var(--color-accent)] font-semibold">{byline}</span>
          <span className="mx-2 text-gray-300">|</span>
          <time dateTime={story.published_at}>
            {formatDate(story.published_at)}
          </time>
          <span className="mx-2 text-gray-300">|</span>
          <span>{readTime} min read</span>
        </p>
        {showUpdated && story.content_updated_at && (
          <p className="mt-2 text-xs font-sans italic text-gray-500">
            Updated{" "}
            <time dateTime={story.content_updated_at}>
              {formatDate(story.content_updated_at)}
            </time>
          </p>
        )}
      </header>

      {story.hero_image_url && (
        <div className="relative w-full aspect-[16/9] mb-10 overflow-hidden">
          <Image
            src={story.hero_image_url}
            alt={story.title}
            fill
            sizes="(max-width: 672px) 100vw, 672px"
            className="object-cover"
            priority
          />
        </div>
      )}

      <div className="story-body">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      {metadata?.source_name && (
        <aside
          className="mt-12 border-t-2 border-[var(--color-accent)] p-6"
          style={{ background: "var(--color-source-bg)" }}
        >
          <p className="category-label mb-2">Source</p>
          <p className="font-serif text-base text-gray-800">
            {metadata.source_url ? (
              <a
                href={metadata.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {metadata.source_name}
              </a>
            ) : (
              metadata.source_name
            )}
          </p>
        </aside>
      )}

      <ShareButtons
        url={`https://woodstockcommunity.news/${story.slug}`}
        title={story.title}
      />

      <RelatedStories stories={related} />
    </article>
  );
}
