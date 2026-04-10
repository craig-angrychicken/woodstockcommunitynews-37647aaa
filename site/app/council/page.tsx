import type { Metadata } from "next";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CouncilStoryCard from "@/components/CouncilStoryCard";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "City Council Coverage",
  description:
    "Woodstock Community News coverage of City Council and Planning Commission meetings — previews, agenda packets, and recaps from the official minutes.",
  alternates: { canonical: "/council" },
};

interface StoryRef {
  id: string;
  title: string;
  slug: string;
  content: string;
  structured_metadata: { subhead?: string | null; byline?: string | null } | null;
  published_at: string | null;
}

interface CouncilMeeting {
  id: string;
  meeting_type: string;
  meeting_date: string;
  agenda_url: string | null;
  packet_url: string | null;
  minutes_url: string | null;
  preview_story: StoryRef | null;
  update_story: StoryRef | null;
  recap_story: StoryRef | null;
}

async function getCouncilMeetings(): Promise<CouncilMeeting[]> {
  const { data } = await supabase
    .from("council_meetings")
    .select(
      `id, meeting_type, meeting_date,
       agenda_url, packet_url, minutes_url,
       preview_story:stories!council_meetings_preview_story_id_fkey(id, title, slug, content, structured_metadata, published_at),
       update_story:stories!council_meetings_update_story_id_fkey(id, title, slug, content, structured_metadata, published_at),
       recap_story:stories!council_meetings_recap_story_id_fkey(id, title, slug, content, structured_metadata, published_at)`
    )
    .order("meeting_date", { ascending: false })
    .limit(30);

  return (data as unknown as CouncilMeeting[]) || [];
}

function formatFullMeetingDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

function hasAnyContent(m: CouncilMeeting): boolean {
  return (
    !!m.preview_story ||
    !!m.update_story ||
    !!m.recap_story ||
    !!m.agenda_url ||
    !!m.packet_url ||
    !!m.minutes_url
  );
}

function MeetingGroup({ meeting }: { meeting: CouncilMeeting }) {
  const stages: Array<{
    stage: "agenda" | "packet" | "minutes";
    story: StoryRef | null;
    pdfUrl: string | null;
  }> = [
    { stage: "agenda", story: meeting.preview_story, pdfUrl: meeting.agenda_url },
    { stage: "packet", story: meeting.update_story, pdfUrl: meeting.packet_url },
    { stage: "minutes", story: meeting.recap_story, pdfUrl: meeting.minutes_url },
  ];

  const storiesPresent = stages.filter((s) => s.story);
  const orphanPdfs = stages.filter((s) => !s.story && s.pdfUrl);

  return (
    <section className="mb-12">
      <header className="mb-4 pb-2 border-b border-[var(--color-rule)]">
        <h2 className="font-display text-2xl font-semibold text-ink leading-tight tracking-tight">
          {formatFullMeetingDate(meeting.meeting_date)}
        </h2>
        <p className="font-sans text-sm text-gray-500 mt-0.5">
          {meeting.meeting_type} meeting
        </p>
      </header>

      {storiesPresent.length > 0 && (
        <div>
          {storiesPresent.map(({ stage, story, pdfUrl }) => (
            <CouncilStoryCard
              key={`${meeting.id}-${stage}`}
              stage={stage}
              meetingType={meeting.meeting_type}
              meetingDate={meeting.meeting_date}
              story={story!}
              sourcePdfUrl={pdfUrl}
            />
          ))}
        </div>
      )}

      {orphanPdfs.length > 0 && (
        <div className="mt-3 text-xs font-sans text-gray-500">
          <span className="text-gray-400">No story yet — </span>
          {orphanPdfs.map((s, i) => (
            <span key={s.stage}>
              {i > 0 && <span className="text-gray-300"> · </span>}
              <a
                href={s.pdfUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--color-accent)] transition-colors underline"
              >
                {s.stage.charAt(0).toUpperCase() + s.stage.slice(1)} PDF
              </a>
            </span>
          ))}
        </div>
      )}

      {storiesPresent.length === 0 && orphanPdfs.length === 0 && (
        <p className="text-sm font-sans italic text-gray-400">
          Documents pending.
        </p>
      )}
    </section>
  );
}

export default async function CouncilPage() {
  const meetings = (await getCouncilMeetings()).filter(hasAnyContent);

  const now = new Date();
  const upcoming = meetings
    .filter((m) => new Date(m.meeting_date) >= now)
    .sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());
  const past = meetings.filter((m) => new Date(m.meeting_date) < now);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 pb-6 border-b-2 border-[var(--color-accent)]">
        <p className="category-label mb-2">Special Section</p>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold text-ink leading-[1.1] tracking-tight">
          City Council Coverage
        </h1>
        <p className="mt-3 font-serif italic text-lg text-gray-600 leading-snug">
          Meeting previews, agenda updates, and recaps for the City of Woodstock
          and Planning Commission.
        </p>
      </header>

      <section className="mb-12 font-serif text-base sm:text-lg text-gray-800 leading-relaxed">
        <p>
          Woodstock&rsquo;s City Council and Planning Commission meetings move
          through three public documents, each released at a different point in
          the process.{" "}
          <strong className="font-semibold text-ink">Agendas</strong> are posted
          in the days before a meeting and lay out what the board plans to
          discuss.{" "}
          <strong className="font-semibold text-ink">Packets</strong> follow
          with the staff reports, maps, and background materials behind each
          item.{" "}
          <strong className="font-semibold text-ink">Minutes</strong> are the
          official record of what was actually said and decided &mdash; voted
          on and released at the following meeting. We publish a story at each
          stage so you can follow a decision from proposal to outcome without
          digging through the PDFs.
        </p>
      </section>

      {meetings.length === 0 ? (
        <p className="font-serif text-gray-600">
          No meetings tracked yet.{" "}
          <Link href="/" className="underline hover:text-[var(--color-accent)]">
            Back to home
          </Link>
        </p>
      ) : (
        <>
          {upcoming.length > 0 && (
            <section className="mb-12">
              <h2 className="category-label mb-4">Upcoming Meetings</h2>
              {upcoming.map((m) => (
                <MeetingGroup key={m.id} meeting={m} />
              ))}
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="category-label mb-4">Recent Coverage</h2>
              {past.map((m) => (
                <MeetingGroup key={m.id} meeting={m} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
