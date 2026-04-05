import type { Metadata } from "next";
import { supabase } from "@/lib/supabase";
import StoryCard from "@/components/StoryCard";

export const metadata: Metadata = {
  title: "Search",
  description: "Search Woodstock Community News stories.",
  alternates: { canonical: "/search" },
};

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
  searchParams: Promise<{ q?: string }>;
};

function escapeIlike(term: string) {
  // Escape PostgREST/ILIKE wildcards so user input is treated as a literal.
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function runSearch(rawQuery: string) {
  const term = rawQuery.trim();
  if (!term) return [];
  const pattern = `%${escapeIlike(term)}%`;
  const { data } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .or(`title.ilike.${pattern},content.ilike.${pattern}`)
    .order("published_at", { ascending: false })
    .limit(50);

  return (data as Story[]) || [];
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const results = query ? await runSearch(query) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 pb-6 border-b-2 border-[var(--color-accent)]">
        <p className="category-label mb-2">Search</p>
        <h1 className="font-display text-4xl font-semibold text-ink leading-[1.1] tracking-tight">
          Find a story
        </h1>
      </header>

      <form action="/search" method="get" className="mb-8">
        <label htmlFor="q" className="sr-only">
          Search stories
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search by title or keyword&hellip;"
            autoFocus
            className="flex-1 px-4 py-3 font-serif text-base bg-white border border-[var(--color-rule)] focus:border-[var(--color-accent)] focus:outline-none"
          />
          <button
            type="submit"
            className="px-5 py-3 text-[11px] font-sans font-semibold tracking-[0.1em] uppercase text-white bg-[var(--color-accent)] hover:opacity-90 transition-opacity"
          >
            Search
          </button>
        </div>
      </form>

      {query && (
        <p className="mb-6 text-sm font-sans text-gray-500">
          {results.length === 0
            ? `No results for "${query}"`
            : `${results.length} result${results.length === 1 ? "" : "s"} for "${query}"`}
        </p>
      )}

      {results.length > 0 && (
        <div>
          {results.map((story) => (
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
    </div>
  );
}
