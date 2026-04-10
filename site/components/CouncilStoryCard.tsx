import Link from "next/link";

type Stage = "agenda" | "packet" | "minutes";

interface CouncilStoryCardProps {
  stage: Stage;
  meetingType: string;
  meetingDate: string;
  story: {
    title: string;
    slug: string;
    content: string;
    structured_metadata: { subhead?: string | null; byline?: string | null } | null;
  };
  sourcePdfUrl: string | null;
}

const stageLabels: Record<Stage, string> = {
  agenda: "Agenda",
  packet: "Packet",
  minutes: "Minutes",
};

const stagePdfLabels: Record<Stage, string> = {
  agenda: "View agenda PDF",
  packet: "View packet PDF",
  minutes: "View minutes PDF",
};

const stageColors: Record<Stage, string> = {
  agenda: "text-gray-500",
  packet: "text-blue-700",
  minutes: "text-[var(--color-accent)]",
};

function formatMeetingDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function getExcerpt(content: string, aiSubhead?: string | null): string {
  if (aiSubhead && !aiSubhead.toLowerCase().startsWith("based on")) {
    return aiSubhead;
  }
  const text = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? text.slice(0, 177).trimEnd() + "…" : text;
}

export default function CouncilStoryCard({
  stage,
  meetingType,
  meetingDate,
  story,
  sourcePdfUrl,
}: CouncilStoryCardProps) {
  const excerpt = getExcerpt(story.content, story.structured_metadata?.subhead);
  const byline = story.structured_metadata?.byline;
  const meetingLabel = `${meetingType.toUpperCase()} · ${formatMeetingDate(meetingDate).toUpperCase()}`;

  return (
    <article className="py-6 border-b border-[var(--color-rule)] last:border-b-0">
      <p className="category-label mb-2">
        <span className={stageColors[stage]}>{stageLabels[stage].toUpperCase()}</span>
        <span className="text-gray-400"> · </span>
        <span className="text-gray-500">{meetingLabel}</span>
      </p>

      <h3 className="font-display text-xl sm:text-2xl font-semibold text-ink leading-snug tracking-tight mb-2">
        <Link href={`/${story.slug}`} className="hover:text-[var(--color-accent)] transition-colors">
          {story.title}
        </Link>
      </h3>

      {excerpt && (
        <p className="font-serif italic text-base text-gray-700 leading-snug mb-3">
          {excerpt}
        </p>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap text-xs font-sans text-gray-500">
        <span>{byline || "Woodstock Community News"}</span>
        {sourcePdfUrl && (
          <a
            href={sourcePdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--color-accent)] transition-colors"
          >
            {stagePdfLabels[stage]} →
          </a>
        )}
      </div>
    </article>
  );
}
