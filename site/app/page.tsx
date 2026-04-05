import { supabase } from "@/lib/supabase";
import StoryCard from "@/components/StoryCard";

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

async function getStories() {
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(30);

  return (data as Story[]) || [];
}

export default async function HomePage() {
  const stories = await getStories();
  if (stories.length === 0) return null;

  // Lead = most recent story that has a hero image; fall back to most recent.
  // Stories that don't qualify still appear below in the news column in their
  // original date order.
  const leadIdx = stories.findIndex((s) => s.hero_image_url);
  const lead = leadIdx >= 0 ? stories[leadIdx] : stories[0];
  const newsColumn = stories.filter((s) => s.id !== lead.id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <StoryCard
        slug={lead.slug}
        title={lead.title}
        content={lead.content}
        heroImageUrl={lead.hero_image_url}
        publishedAt={lead.published_at}
        structuredMetadata={lead.structured_metadata}
        variant="lead"
      />

      <section className="mt-10">
        <h2 className="category-label mb-2">Latest News</h2>
        <div>
          {newsColumn.map((story) => (
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
      </section>
    </div>
  );
}
