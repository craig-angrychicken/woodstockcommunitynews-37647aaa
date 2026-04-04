import { notFound } from "next/navigation";
import Image from "next/image";
import type { Metadata, ResolvingMetadata } from "next";
import { supabase } from "@/lib/supabase";
import { estimateReadTime, formatDate, getExcerpt } from "@/lib/formatting";
import RelatedStories from "@/components/RelatedStories";

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
      "id, title, content, slug, hero_image_url, published_at, structured_metadata, word_count"
    )
    .eq("slug", slug)
    .eq("status", "published")
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
  { params }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;
  const story = await getStory(slug);
  if (!story) return {};

  const metadata = story.structured_metadata;
  const description = getExcerpt(story.content, metadata?.subhead);

  return {
    title: story.title,
    description,
    openGraph: {
      title: story.title,
      description,
      type: "article",
      publishedTime: story.published_at,
      authors: [metadata?.byline || "Woodstock Community News"],
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

  const related = await getRelatedStories(story.id);

  return (
    <article className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-bold text-gray-900 leading-tight">
          {story.title}
        </h1>
        <p className="mt-4 text-sm text-gray-500">
          <span>{byline}</span>
          <span className="mx-1">&middot;</span>
          <time dateTime={story.published_at}>
            {formatDate(story.published_at)}
          </time>
          <span className="mx-1">&middot;</span>
          <span>{readTime} min read</span>
        </p>
      </header>

      {story.hero_image_url && (
        <div className="relative w-full aspect-[16/9] mb-8 rounded-lg overflow-hidden">
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

      <div className="prose prose-gray max-w-none">
        {metadata?.subhead && (
          <p className="text-lg text-gray-600 italic mb-6">
            {metadata.subhead}
          </p>
        )}

        {paragraphs.map((paragraph, i) => (
          <p key={i} className="mb-4 leading-relaxed">
            {paragraph}
          </p>
        ))}
      </div>

      {metadata?.source_name && (
        <div className="mt-10 pt-6 border-t border-gray-200">
          <p className="text-sm text-gray-600 italic">
            Source:{" "}
            {metadata.source_url ? (
              <a
                href={metadata.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-800 hover:underline"
              >
                {metadata.source_name}
              </a>
            ) : (
              metadata.source_name
            )}
          </p>
        </div>
      )}

      <RelatedStories stories={related} />
    </article>
  );
}
