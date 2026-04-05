import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import StoryCard from "@/components/StoryCard";
import {
  findTopic,
  getTopicBySlug,
  getAllTopicSlugs,
  TOPICS,
} from "@/lib/topics";

export const revalidate = 3600;

interface Story {
  id: string;
  title: string;
  content: string | null;
  slug: string;
  hero_image_url: string | null;
  published_at: string;
  structured_metadata: { subhead?: string; byline?: string } | null;
}

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllTopicSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) return {};
  return {
    title: topic.name,
    description: topic.description,
    alternates: { canonical: `/topic/${topic.slug}` },
  };
}

async function getStoriesForTopic(targetSlug: string) {
  // Fetch most recent published stories, then filter client-side by classifier.
  // 200 is generous for a ~monthly cadence and keeps one DB query per topic page.
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(200);

  const stories = (data as Story[]) || [];
  return stories.filter((s) => {
    const haystack = `${s.title} ${s.structured_metadata?.subhead ?? ""}`;
    return findTopic(haystack).slug === targetSlug;
  });
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) notFound();

  const stories = await getStoriesForTopic(slug);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 pb-6 border-b-2 border-[var(--color-accent)]">
        <p className="category-label mb-2">Topic</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink leading-[1.1] tracking-tight">
          {topic.name}
        </h1>
        <p className="mt-3 font-serif italic text-lg text-gray-600 leading-snug">
          {topic.description}
        </p>
      </header>

      {stories.length === 0 ? (
        <p className="font-serif text-gray-600">
          No stories in this topic yet.{" "}
          <Link href="/" className="underline hover:text-[var(--color-accent)]">
            Back to home
          </Link>
        </p>
      ) : (
        <div>
          {stories.map((story) => (
            <StoryCard
              key={story.id}
              slug={story.slug}
              title={story.title}
              content={story.content}
              heroImageUrl={story.hero_image_url}
              publishedAt={story.published_at}
              structuredMetadata={story.structured_metadata}
              variant="row"
            />
          ))}
        </div>
      )}

      <nav
        aria-label="All topics"
        className="mt-10 pt-6 border-t border-[var(--color-rule)]"
      >
        <p className="category-label mb-3">All Topics</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {TOPICS.map((t) => (
            <Link
              key={t.slug}
              href={`/topic/${t.slug}`}
              className={`text-[13px] font-sans hover:text-[var(--color-accent)] transition-colors ${
                t.slug === slug
                  ? "text-[var(--color-accent)] font-semibold"
                  : "text-gray-600"
              }`}
            >
              {t.name}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
