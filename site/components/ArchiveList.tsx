import Link from "next/link";
import { notFound } from "next/navigation";
import StoryCard from "@/components/StoryCard";
import { supabase } from "@/lib/supabase";

export const PAGE_SIZE = 30;

interface ArchiveStory {
  id: string;
  title: string;
  content: string | null;
  slug: string;
  hero_image_url: string | null;
  published_at: string;
  structured_metadata: { subhead?: string; byline?: string } | null;
}

async function getArchivePage(page: number) {
  const from = (page - 1) * PAGE_SIZE;
  const to = page * PAGE_SIZE - 1;

  const { data, count } = await supabase
    .from("stories")
    .select(
      "id, title, content, slug, hero_image_url, published_at, structured_metadata",
      { count: "exact" }
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .range(from, to);

  return {
    stories: (data as ArchiveStory[]) || [],
    total: count || 0,
  };
}

export default async function ArchiveList({ page }: { page: number }) {
  if (!Number.isInteger(page) || page < 1) notFound();

  const { stories, total } = await getArchivePage(page);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (stories.length === 0 && page > 1) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-6 pb-4 border-b-2 border-[var(--color-accent)]">
        <p className="category-label">Archive</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-ink tracking-tight">
          All Stories
        </h1>
        <p className="mt-1 text-sm font-sans text-gray-500">
          {total} stories &middot; Page {page} of {totalPages}
        </p>
      </header>

      <section>
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
      </section>

      <ArchivePagination page={page} totalPages={totalPages} />
    </div>
  );
}

function ArchivePagination({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const prevHref =
    page === 2 ? "/archive" : page > 2 ? `/archive/${page - 1}` : null;
  const nextHref = page < totalPages ? `/archive/${page + 1}` : null;

  return (
    <nav
      className="mt-10 pt-6 border-t border-[var(--color-rule)] flex items-center justify-between font-sans text-sm"
      aria-label="Archive pagination"
    >
      {prevHref ? (
        <Link
          href={prevHref}
          className="text-[var(--color-accent)] font-semibold hover:underline"
        >
          &larr; Newer
        </Link>
      ) : (
        <span className="text-gray-300">&larr; Newer</span>
      )}

      <PageNumbers page={page} totalPages={totalPages} />

      {nextHref ? (
        <Link
          href={nextHref}
          className="text-[var(--color-accent)] font-semibold hover:underline"
        >
          Older &rarr;
        </Link>
      ) : (
        <span className="text-gray-300">Older &rarr;</span>
      )}
    </nav>
  );
}

function PageNumbers({
  page,
  totalPages,
}: {
  page: number;
  totalPages: number;
}) {
  // Show up to 7 page numbers: window around current page
  const windowSize = 7;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const pages: number[] = [];
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <ul className="hidden sm:flex gap-1 text-[11px] font-semibold tracking-[0.08em] uppercase">
      {pages.map((p) => {
        const href = p === 1 ? "/archive" : `/archive/${p}`;
        const isActive = p === page;
        return (
          <li key={p}>
            {isActive ? (
              <span className="px-2 py-1 text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]">
                {p}
              </span>
            ) : (
              <Link
                href={href}
                className="px-2 py-1 text-gray-500 hover:text-[var(--color-accent)] transition-colors"
              >
                {p}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
