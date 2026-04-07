import Link from "next/link";

interface StoryRef {
  id: string;
  title: string;
  slug: string;
  published_at: string;
}

interface MeetingCardProps {
  meetingType: string;
  meetingDate: string;
  agendaUrl: string | null;
  packetUrl: string | null;
  minutesUrl: string | null;
  previewStory: StoryRef | null;
  updateStory: StoryRef | null;
  recapStory: StoryRef | null;
}

function formatMeetingDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

const stages = [
  { key: "agenda", label: "Agenda", storyLabel: "Preview" },
  { key: "packet", label: "Packet", storyLabel: "Update" },
  { key: "minutes", label: "Minutes", storyLabel: "Recap" },
] as const;

export default function MeetingCard({
  meetingType,
  meetingDate,
  agendaUrl,
  packetUrl,
  minutesUrl,
  previewStory,
  updateStory,
  recapStory,
}: MeetingCardProps) {
  const docUrls: Record<string, string | null> = {
    agenda: agendaUrl,
    packet: packetUrl,
    minutes: minutesUrl,
  };
  const stories: Record<string, StoryRef | null> = {
    agenda: previewStory,
    packet: updateStory,
    minutes: recapStory,
  };

  const isPast = new Date(meetingDate) < new Date();

  return (
    <div className="py-6 border-b border-[var(--color-rule)]">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h3 className="font-display text-xl font-semibold text-ink leading-snug tracking-tight">
          {meetingType}
        </h3>
        <time
          dateTime={meetingDate}
          className="text-sm font-sans text-gray-500 whitespace-nowrap"
        >
          {formatMeetingDate(meetingDate)}
        </time>
      </div>

      {/* Document + story progress */}
      <div className="flex gap-6 flex-wrap">
        {stages.map(({ key, label, storyLabel }) => {
          const docUrl = docUrls[key];
          const story = stories[key];
          const hasDoc = !!docUrl;

          return (
            <div key={key} className="flex flex-col gap-1">
              {/* Document status */}
              <div className="flex items-center gap-1.5 text-xs font-sans">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    hasDoc ? "bg-green-500" : "bg-gray-300"
                  }`}
                />
                {hasDoc && docUrl ? (
                  <a
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-600 hover:text-[var(--color-accent)] transition-colors"
                  >
                    {label}
                  </a>
                ) : (
                  <span className="text-gray-400">
                    {label} {!isPast && !hasDoc ? "(pending)" : ""}
                  </span>
                )}
              </div>

              {/* Story link */}
              {story ? (
                <Link
                  href={`/${story.slug}`}
                  className="text-sm font-serif text-[var(--color-accent)] hover:underline leading-snug"
                >
                  {storyLabel}
                </Link>
              ) : hasDoc ? (
                <span className="text-xs font-sans text-gray-400 italic">
                  {storyLabel} pending
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
