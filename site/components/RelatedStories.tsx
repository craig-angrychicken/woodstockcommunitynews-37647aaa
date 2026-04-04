import StoryCard from "./StoryCard";

interface Story {
  id: string;
  slug: string;
  title: string;
  content: string | null;
  hero_image_url: string | null;
  published_at: string;
  structured_metadata: { subhead?: string; byline?: string } | null;
}

export default function RelatedStories({ stories }: { stories: Story[] }) {
  if (stories.length === 0) return null;

  return (
    <section className="mt-12 pt-8 border-t border-gray-100">
      <h2 className="font-serif text-xl font-bold text-gray-900 mb-6">
        More Stories
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        {stories.map((story) => (
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
  );
}
