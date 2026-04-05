import { supabase } from "@/lib/supabase";
import StoryCard from "@/components/StoryCard";
import Link from "next/link";
import { formatDate } from "@/lib/formatting";

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
  if (stories.length === 0) return null;

  // Lead story = first featured, else most recent
  const featuredStory = stories.find((s) => s.featured);
  const lead = featuredStory || stories[0];
  const remaining = stories.filter((s) => s.id !== lead.id);
  const newsColumn = remaining.slice(0, 7);
  const sidebarList = remaining.slice(7, 17);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Lead story — full width */}
      <StoryCard
        slug={lead.slug}
        title={lead.title}
        content={lead.content}
        heroImageUrl={lead.hero_image_url}
        publishedAt={lead.published_at}
        structuredMetadata={lead.structured_metadata}
        variant="lead"
      />

      {/* Two-column layout: news column + sidebar */}
      <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-12">
        {/* Main news column */}
        <section className="lg:col-span-2">
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

        {/* Sidebar — most recent text list */}
        {sidebarList.length > 0 && (
          <aside className="lg:col-span-1 lg:border-l lg:border-[var(--color-rule)] lg:pl-8">
            <h2 className="category-label mb-2">Most Recent</h2>
            <ul className="divide-y divide-[var(--color-rule)]">
              {sidebarList.map((story) => (
                <li key={story.id}>
                  <Link href={`/${story.slug}`} className="block py-3 group">
                    <time
                      dateTime={story.published_at}
                      className="text-[11px] font-sans font-semibold tracking-[0.08em] uppercase text-gray-400 block"
                    >
                      {formatDate(story.published_at)}
                    </time>
                    <h3 className="mt-1 font-display text-base font-semibold text-ink group-hover:text-[var(--color-accent)] transition-colors leading-snug">
                      {story.title}
                    </h3>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/about"
              className="mt-6 inline-block text-[11px] font-sans font-semibold tracking-[0.1em] uppercase text-[var(--color-accent)] hover:underline"
            >
              About us &rarr;
            </Link>
          </aside>
        )}
      </div>
    </div>
  );
}
