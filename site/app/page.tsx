import { supabase } from "@/lib/supabase";
import StoryCard from "@/components/StoryCard";
import Link from "next/link";

export const revalidate = 3600;

interface Story {
  id: string;
  title: string;
  content: string | null;
  slug: string;
  hero_image_url: string | null;
  published_at: string;
  structured_metadata: { subhead?: string; byline?: string } | null;
  featured: boolean;
}

async function getStories() {
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata, featured"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(50);

  return (data as Story[]) || [];
}

export default async function HomePage() {
  const stories = await getStories();
  const featured = stories.filter((s) => s.featured);
  const latest = stories.filter((s) => !s.featured);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      {featured.length > 0 && (
        <section className="mb-12">
          <h2 className="font-serif text-2xl font-bold text-gray-900 mb-6">
            Featured
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {featured.map((story) => (
              <StoryCard
                key={story.id}
                slug={story.slug}
                title={story.title}
                content={story.content}
                heroImageUrl={story.hero_image_url}
                publishedAt={story.published_at}
                structuredMetadata={story.structured_metadata}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl font-bold text-gray-900">
            Latest
          </h2>
          <Link
            href="/about"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            About us &rarr;
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {latest.map((story) => (
            <StoryCard
              key={story.id}
              slug={story.slug}
              title={story.title}
              content={story.content}
              heroImageUrl={story.hero_image_url}
              publishedAt={story.published_at}
              structuredMetadata={story.structured_metadata}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
